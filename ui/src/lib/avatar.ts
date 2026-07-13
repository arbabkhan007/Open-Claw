import { isRenderableAvatarImageDataUrl } from "../../../src/shared/avatar-limits.js";
import type { AgentIdentityResult } from "../api/types.ts";
import { DEFAULT_ASSISTANT_AVATAR } from "./assistant-identity.ts";
import { normalizeOptionalString } from "./string-coerce.ts";

const CONTROL_UI_SAME_ORIGIN_AVATAR_URL_RE = /^\/(?!\/)/;
const UNSAFE_ASSISTANT_TEXT_AVATAR_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

export function isRenderableControlUiAvatarUrl(value: string): boolean {
  return isRenderableAvatarImageDataUrl(value) || CONTROL_UI_SAME_ORIGIN_AVATAR_URL_RE.test(value);
}

export function resolveAgentAvatarUrl(
  agent: { identity?: { avatar?: string; avatarUrl?: string } },
  agentIdentity?: AgentIdentityResult | null,
): string | null {
  const candidates = [
    normalizeOptionalString(agentIdentity?.avatar),
    normalizeOptionalString(agent.identity?.avatarUrl),
    normalizeOptionalString(agent.identity?.avatar),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (isRenderableControlUiAvatarUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Chat-render variant: accept blob URLs produced by authenticated avatar fetches.
export function resolveChatAvatarRenderUrl(
  candidate: string | null | undefined,
  agent: { identity?: { avatar?: string; avatarUrl?: string } },
  agentIdentity?: AgentIdentityResult | null,
): string | null {
  const trimmed = normalizeOptionalString(candidate);
  if (trimmed?.startsWith("blob:")) {
    return trimmed;
  }
  return resolveAgentAvatarUrl(agent, agentIdentity);
}

export function deriveAvatarInitial(value: string | null | undefined): string {
  const source = value ?? "";
  if (!source) {
    return "";
  }

  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const firstSegment = segmenter.segment(source)[Symbol.iterator]().next();
    if (!firstSegment || !firstSegment.value) {
      return "";
    }
    return firstSegment.value.segment.toUpperCase();
  }

  const firstCodeUnit = source.charCodeAt(0);
  const isLeadingSurrogate = firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff;
  if (isLeadingSurrogate && source.length > 1) {
    const secondCodeUnit = source.charCodeAt(1);
    const isTrailingSurrogate = secondCodeUnit >= 0xdc00 && secondCodeUnit <= 0xdfff;
    if (isTrailingSurrogate) {
      return source.slice(0, 2).toUpperCase();
    }
  }

  return source.slice(0, 1).toUpperCase();
}

export function resolveAssistantTextAvatar(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === DEFAULT_ASSISTANT_AVATAR) {
    return null;
  }
  if (trimmed.startsWith("blob:") || isRenderableControlUiAvatarUrl(trimmed)) {
    return null;
  }
  if (
    trimmed.length > 8 ||
    /\s/.test(trimmed) ||
    /[\\/.:]/.test(trimmed) ||
    UNSAFE_ASSISTANT_TEXT_AVATAR_CHARS.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}
