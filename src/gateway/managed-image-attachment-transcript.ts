import fs from "node:fs/promises";
import { parseManagedOutgoingImageUrl } from "./managed-image-attachment-route.js";
import {
  attachManagedImageRecordToMessage,
  type ManagedImageRecord,
} from "./managed-image-record-store.js";
import { readSessionMessagesWithSourceAsync } from "./session-transcript-readers.js";
import { loadSessionEntry, resolveSessionHistoryTranscriptPathAsync } from "./session-utils.js";

export type SessionManagedOutgoingAttachmentIndex = Set<string>;

type SessionManagedOutgoingAttachmentIndexCacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  size: number;
  index: SessionManagedOutgoingAttachmentIndex;
};

type SessionManagedOutgoingAttachmentTranscriptStat = Omit<
  SessionManagedOutgoingAttachmentIndexCacheEntry,
  "index"
>;

const sessionManagedOutgoingAttachmentIndexCache = new Map<
  string,
  SessionManagedOutgoingAttachmentIndexCacheEntry
>();
const MAX_SESSION_MANAGED_OUTGOING_ATTACHMENT_INDEX_CACHE_ENTRIES = 500;

function buildSessionManagedOutgoingAttachmentIndexCacheKey(
  sessionKey: string,
  agentId?: string,
): string {
  return sessionKey === "global" && agentId ? `agent:${agentId}:global` : sessionKey;
}

function buildManagedOutgoingAttachmentRefKey(messageId: string, attachmentId: string) {
  return `${messageId}::${attachmentId}`;
}

function collectManagedOutgoingAttachmentRefs(
  blocks: readonly Record<string, unknown>[] | undefined,
  expectedSessionKey?: string,
) {
  const refs = new Map<string, { attachmentId: string; sessionKey: string }>();
  for (const block of blocks ?? []) {
    if (block?.type !== "image") {
      continue;
    }
    for (const candidate of [block.url, block.openUrl]) {
      if (typeof candidate !== "string") {
        continue;
      }
      const parsed = parseManagedOutgoingImageUrl(candidate);
      if (!parsed || (expectedSessionKey && parsed.sessionKey !== expectedSessionKey)) {
        continue;
      }
      refs.set(parsed.attachmentId, {
        attachmentId: parsed.attachmentId,
        sessionKey: parsed.sessionKey,
      });
    }
  }
  return [...refs.values()];
}

function getCachedSessionManagedOutgoingAttachmentIndex(
  sessionKey: string,
  agentId: string | undefined,
  stat: SessionManagedOutgoingAttachmentTranscriptStat,
) {
  const cacheKey = buildSessionManagedOutgoingAttachmentIndexCacheKey(sessionKey, agentId);
  const cached = sessionManagedOutgoingAttachmentIndexCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (
    cached.transcriptPath !== stat.transcriptPath ||
    cached.mtimeMs !== stat.mtimeMs ||
    cached.size !== stat.size
  ) {
    sessionManagedOutgoingAttachmentIndexCache.delete(cacheKey);
    return null;
  }
  sessionManagedOutgoingAttachmentIndexCache.delete(cacheKey);
  sessionManagedOutgoingAttachmentIndexCache.set(cacheKey, cached);
  return cached.index;
}

function setCachedSessionManagedOutgoingAttachmentIndex(
  sessionKey: string,
  agentId: string | undefined,
  stat: SessionManagedOutgoingAttachmentTranscriptStat,
  index: SessionManagedOutgoingAttachmentIndex,
) {
  sessionManagedOutgoingAttachmentIndexCache.set(
    buildSessionManagedOutgoingAttachmentIndexCacheKey(sessionKey, agentId),
    { ...stat, index },
  );
  while (
    sessionManagedOutgoingAttachmentIndexCache.size >
    MAX_SESSION_MANAGED_OUTGOING_ATTACHMENT_INDEX_CACHE_ENTRIES
  ) {
    const oldestKey = sessionManagedOutgoingAttachmentIndexCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sessionManagedOutgoingAttachmentIndexCache.delete(oldestKey);
  }
}

function sameManagedOutgoingAttachmentTranscriptStat(
  left: SessionManagedOutgoingAttachmentTranscriptStat | null,
  right: SessionManagedOutgoingAttachmentTranscriptStat | null,
): boolean {
  return (
    left?.transcriptPath === right?.transcriptPath &&
    left?.mtimeMs === right?.mtimeMs &&
    left?.size === right?.size
  );
}

async function getSessionManagedOutgoingAttachmentIndex(
  sessionKey: string,
  cache?: Map<string, SessionManagedOutgoingAttachmentIndex | null>,
  agentId?: string,
) {
  const cacheKey = buildSessionManagedOutgoingAttachmentIndexCacheKey(sessionKey, agentId);
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }
  const { storePath, entry } = loadSessionEntry(
    sessionKey,
    sessionKey === "global" && agentId ? { agentId } : undefined,
  );
  const sessionId = entry?.sessionId;
  if (!sessionId) {
    cache?.set(cacheKey, null);
    return null;
  }

  let transcriptStat: SessionManagedOutgoingAttachmentTranscriptStat | null = null;
  const resolvedTranscriptPath = await resolveSessionHistoryTranscriptPathAsync(
    sessionId,
    storePath,
    entry.sessionFile,
    { allowResetArchiveFallback: true },
  );
  if (resolvedTranscriptPath) {
    try {
      const stat = await fs.stat(resolvedTranscriptPath);
      transcriptStat = {
        transcriptPath: resolvedTranscriptPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
      const cachedIndex = getCachedSessionManagedOutgoingAttachmentIndex(
        sessionKey,
        agentId,
        transcriptStat,
      );
      if (cachedIndex) {
        cache?.set(cacheKey, cachedIndex);
        return cachedIndex;
      }
    } catch {
      sessionManagedOutgoingAttachmentIndexCache.delete(cacheKey);
    }
  } else {
    sessionManagedOutgoingAttachmentIndexCache.delete(cacheKey);
  }

  const readResult = await readSessionMessagesWithSourceAsync(
    { agentId, sessionEntry: entry, sessionId, sessionKey, storePath },
    {
      mode: "full",
      reason: "managed outgoing attachment index",
      allowResetArchiveFallback: true,
    },
  );
  const preReadTranscriptStat = transcriptStat;
  if (readResult.transcriptPath) {
    try {
      const stat = await fs.stat(readResult.transcriptPath);
      const postReadTranscriptStat = {
        transcriptPath: readResult.transcriptPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
      transcriptStat = sameManagedOutgoingAttachmentTranscriptStat(
        preReadTranscriptStat,
        postReadTranscriptStat,
      )
        ? postReadTranscriptStat
        : null;
    } catch {
      transcriptStat = null;
    }
  } else {
    transcriptStat = null;
  }

  const index: SessionManagedOutgoingAttachmentIndex = new Set();
  for (const message of readResult.messages) {
    const messageId = (message as { __openclaw?: { id?: string } } | null)?.["__openclaw"]?.id;
    if (typeof messageId !== "string" || !messageId) {
      continue;
    }
    const content = (message as { content?: unknown[] } | null)?.content;
    for (const ref of collectManagedOutgoingAttachmentRefs(
      Array.isArray(content) ? (content as Record<string, unknown>[]) : [],
      sessionKey,
    )) {
      index.add(buildManagedOutgoingAttachmentRefKey(messageId, ref.attachmentId));
    }
  }

  if (transcriptStat) {
    setCachedSessionManagedOutgoingAttachmentIndex(sessionKey, agentId, transcriptStat, index);
  }
  cache?.set(cacheKey, index);
  return index;
}

export async function recordMatchesTranscriptMessage(
  record: ManagedImageRecord,
  cache?: Map<string, SessionManagedOutgoingAttachmentIndex | null>,
) {
  if (!record.messageId) {
    return false;
  }
  const index = await getSessionManagedOutgoingAttachmentIndex(
    record.sessionKey,
    cache,
    record.agentId,
  );
  return (
    index?.has(buildManagedOutgoingAttachmentRefKey(record.messageId, record.attachmentId)) ?? false
  );
}

export async function attachManagedOutgoingImagesToMessage(params: {
  messageId: string;
  blocks?: readonly Record<string, unknown>[];
  stateDir?: string;
}) {
  const messageId = params.messageId.trim();
  if (!messageId) {
    return;
  }
  const refs = collectManagedOutgoingAttachmentRefs(params.blocks);
  if (refs.length === 0) {
    return;
  }
  await Promise.all(
    refs.map(async ({ attachmentId, sessionKey }) => {
      attachManagedImageRecordToMessage({
        attachmentId,
        sessionKey,
        messageId,
        updatedAt: new Date().toISOString(),
        stateDir: params.stateDir,
      });
    }),
  );
}
