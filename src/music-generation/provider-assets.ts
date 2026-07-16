// Validates and normalizes provider asset attachments for music generation.
import { maxBytesForKind } from "@openclaw/media-core/constants";
import { extensionForMime } from "@openclaw/media-core/mime";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { readResponseTextPrefix, readResponseWithLimit } from "../infra/http-body.js";
import { fetchProviderOperationResponse } from "../media-understanding/shared.js";
import type { GeneratedMusicAsset } from "./types.js";

const GENERATED_MUSIC_ERROR_BODY_MAX_BYTES = 16 * 1024;

function resolveGeneratedMusicDownloadBodyTimeout(params: {
  provider: string;
  timeoutMs: number;
  deadlineMs: number;
}) {
  return {
    chunkTimeoutMs: params.timeoutMs,
    timeoutMs: Math.max(1, params.deadlineMs - Date.now()),
    onIdleTimeout: ({ chunkTimeoutMs }: { chunkTimeoutMs: number }) =>
      new Error(`${params.provider} generated music download stalled after ${chunkTimeoutMs}ms`),
    onTimeout: () =>
      new Error(
        `${params.provider} generated music download timed out after ${params.timeoutMs}ms`,
      ),
  };
}

/**
 * Asset extraction and download helpers for music generation providers.
 *
 * Providers may return audio as URLs, file objects, or base64 payloads; these
 * helpers normalize those shapes into bounded in-memory GeneratedMusicAsset values.
 */
/** Candidate audio file returned by a provider before download. */
export type GeneratedMusicFileCandidate = {
  url: string;
  mimeType?: string;
  fileName?: string;
};

function normalizeSpecificAudioMimeType(value: unknown): string | undefined {
  const mimeType = normalizeOptionalString(value)?.split(";")[0]?.trim().toLowerCase();
  // Generic binary types are less useful than known audio fallbacks for saved track names.
  if (!mimeType || mimeType === "application/octet-stream" || mimeType === "binary/octet-stream") {
    return undefined;
  }
  return mimeType;
}

function pushGeneratedMusicFileCandidate(
  candidates: GeneratedMusicFileCandidate[],
  value: unknown,
): void {
  if (typeof value === "string") {
    const url = normalizeOptionalString(value);
    if (url) {
      candidates.push({ url });
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const url = normalizeOptionalString(value.url);
  if (!url) {
    return;
  }
  candidates.push({
    url,
    ...(normalizeOptionalString(value.content_type)
      ? { mimeType: normalizeOptionalString(value.content_type) }
      : {}),
    ...(normalizeOptionalString(value.file_name)
      ? { fileName: normalizeOptionalString(value.file_name) }
      : {}),
  });
}

/** Extract URL/file candidates from common provider response keys. */
export function extractGeneratedMusicFileCandidates(
  payload: unknown,
  keys: readonly string[] = ["audio", "audio_file"],
): GeneratedMusicFileCandidate[] {
  if (!isRecord(payload)) {
    return [];
  }
  const candidates: GeneratedMusicFileCandidate[] = [];
  for (const key of keys) {
    pushGeneratedMusicFileCandidate(candidates, payload[key]);
  }
  return candidates;
}

/** Convert a base64 provider payload into a generated music asset. */
export function generatedMusicAssetFromBase64(params: {
  base64: string;
  mimeType: string;
  index?: number;
  fileName?: string;
}): GeneratedMusicAsset {
  const ext = extensionForMime(params.mimeType)?.replace(/^\./u, "") || "mp3";
  return {
    buffer: Buffer.from(params.base64, "base64"),
    mimeType: params.mimeType,
    fileName: params.fileName ?? `track-${(params.index ?? 0) + 1}.${ext}`,
  };
}

/** Download a generated music URL with size limits and inferred audio metadata. */
export async function downloadGeneratedMusicAsset(params: {
  candidate: GeneratedMusicFileCandidate;
  timeoutMs: number;
  fetchFn: typeof fetch;
  provider: string;
  requestFailedMessage: string;
  index?: number;
  maxBytes?: number;
}): Promise<GeneratedMusicAsset> {
  // fetchWithTimeout clears its abort after headers land. Keep one wall-clock deadline across
  // non-2xx error-detail and successful-body reads so a slow drip cannot reset chunk idle forever.
  // Omit requestFailedMessage so shared assertOkOrThrowHttpError cannot consume a dripping error
  // body without a wall-clock bound before this helper's timed readers run.
  const deadlineMs = Date.now() + params.timeoutMs;
  const response = await fetchProviderOperationResponse({
    stage: "download",
    url: params.candidate.url,
    init: { method: "GET" },
    timeoutMs: () => Math.max(1, deadlineMs - Date.now()),
    fetchFn: params.fetchFn,
    provider: params.provider,
  });
  const bodyTimeout = resolveGeneratedMusicDownloadBodyTimeout({
    provider: params.provider,
    timeoutMs: params.timeoutMs,
    deadlineMs,
  });
  if (!response.ok) {
    const prefix = await readResponseTextPrefix(
      response,
      GENERATED_MUSIC_ERROR_BODY_MAX_BYTES,
      bodyTimeout,
    );
    const detail = prefix.text.replace(/\s+/g, " ").trim();
    throw new Error(
      `${params.requestFailedMessage} (HTTP ${response.status})` +
        (detail ? `: ${detail.length > 220 ? `${detail.slice(0, 219)}…` : detail}` : ""),
    );
  }
  const mimeType =
    normalizeSpecificAudioMimeType(response.headers.get("content-type")) ??
    normalizeSpecificAudioMimeType(params.candidate.mimeType) ??
    "audio/mpeg";
  const ext = extensionForMime(mimeType)?.replace(/^\./u, "") || "mp3";
  const maxBytes = params.maxBytes ?? maxBytesForKind("audio");
  return {
    buffer: await readResponseWithLimit(response, maxBytes, {
      ...bodyTimeout,
      onOverflow: ({ maxBytes: maxBytesLocal }) =>
        new Error(`${params.provider} generated music download exceeds ${maxBytesLocal} bytes`),
    }),
    mimeType,
    fileName: params.candidate.fileName ?? `track-${(params.index ?? 0) + 1}.${ext}`,
    metadata: {
      url: params.candidate.url,
    },
  };
}
