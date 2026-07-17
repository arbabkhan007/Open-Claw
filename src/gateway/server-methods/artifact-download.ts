// Artifact download parsing and managed outgoing image resolution.
import { isHttpUrl } from "@openclaw/net-policy/url-protocol";
import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";
import { normalizeOptionalString as asNonEmptyString } from "@openclaw/normalization-core/string-coerce";
import type { ArtifactSummary } from "../../../packages/gateway-protocol/src/index.js";
import { createLazyRuntimeNamedExport } from "../../shared/lazy-runtime.js";

const loadReadManagedOutgoingImageDownloadUrl = createLazyRuntimeNamedExport(
  () => import("../managed-image-attachments-download.js"),
  "readManagedOutgoingImageDownloadUrl",
);

type ArtifactDownloadMode = ArtifactSummary["download"]["mode"];

export type ArtifactRecord = ArtifactSummary & {
  data?: string;
  url?: string;
};

type ArtifactBase64Payload = {
  data?: string;
  sizeBytes: number;
};

function mimeFromDataUrl(value: string): string | undefined {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(value.trim());
  return match?.[1]?.toLowerCase();
}

function base64FromDataUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0 || trimmed.slice(0, 5).toLowerCase() !== "data:") {
    return undefined;
  }
  const metadata = trimmed.slice(0, commaIndex).toLowerCase();
  if (!metadata.includes(";base64")) {
    return undefined;
  }
  return trimmed.slice(commaIndex + 1);
}

function isBase64Whitespace(value: string): boolean {
  return value === " " || value === "\n" || value === "\r" || value === "\t";
}

function isArtifactBase64DataChar(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    value === "+" ||
    value === "/" ||
    value === "-" ||
    value === "_"
  );
}

function normalizeArtifactBase64Char(value: string): string {
  if (value === "-") {
    return "+";
  }
  if (value === "_") {
    return "/";
  }
  return value;
}

function readArtifactBase64Payload(
  value: string | undefined,
  opts: { includeData: boolean },
): ArtifactBase64Payload | undefined {
  if (!value) {
    return undefined;
  }
  let encodedLength = 0;
  let padding = 0;
  let sawPadding = false;
  let data = opts.includeData ? "" : undefined;
  for (const char of value) {
    if (isBase64Whitespace(char)) {
      continue;
    }
    if (char === "=") {
      padding += 1;
      if (padding > 2) {
        return undefined;
      }
      sawPadding = true;
      encodedLength += 1;
      if (data !== undefined) {
        data += char;
      }
      continue;
    }
    if (sawPadding || !isArtifactBase64DataChar(char)) {
      return undefined;
    }
    encodedLength += 1;
    if (data !== undefined) {
      data += normalizeArtifactBase64Char(char);
    }
  }
  if (encodedLength === 0) {
    return undefined;
  }
  const remainder = encodedLength % 4;
  if ((padding > 0 && remainder !== 0) || remainder === 1) {
    return undefined;
  }
  if (data !== undefined && padding === 0 && remainder > 0) {
    data += "=".repeat(4 - remainder);
  }
  return {
    ...(data !== undefined ? { data } : {}),
    sizeBytes: Math.max(0, Math.floor((encodedLength * 3) / 4) - padding),
  };
}

function mediaUrlValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return asNonEmptyString(value);
  }
  const record = asOptionalRecord(value);
  return asNonEmptyString(record?.url);
}

function isSafeDownloadUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^data:/i.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//") && trimmed.startsWith("/api/");
  }
  return isHttpUrl(trimmed);
}

export function resolveBlockDownload(
  block: Record<string, unknown>,
  opts: { includeData: boolean },
): {
  mode: ArtifactDownloadMode;
  data?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
} {
  const data = asNonEmptyString(block.data);
  const content = asNonEmptyString(block.content);
  const url = asNonEmptyString(block.url) ?? asNonEmptyString(block.openUrl);
  const imageUrl = mediaUrlValue(block.image_url);
  const audioUrl = asNonEmptyString(block.audio_url);
  const source = asOptionalRecord(block.source);
  const sourceData = asNonEmptyString(source?.data);
  const sourceUrl = asNonEmptyString(source?.url);
  const dataUrl = [url, sourceUrl, imageUrl, audioUrl, data, content, sourceData].find(
    (value) => typeof value === "string" && /^data:/i.test(value),
  );
  const base64FromDetectedDataUrl = readArtifactBase64Payload(
    dataUrl ? base64FromDataUrl(dataUrl) : undefined,
    opts,
  );
  const directBase64 = [data, sourceData, content]
    .filter((value): value is string => typeof value === "string" && !/^data:/i.test(value))
    .map((value) => readArtifactBase64Payload(value, opts))
    .find((value): value is ArtifactBase64Payload => value !== undefined);
  const base64 = base64FromDetectedDataUrl ?? directBase64;
  const remoteUrl = [url, sourceUrl, imageUrl, audioUrl].find(
    (value) => typeof value === "string" && isSafeDownloadUrl(value),
  );
  const mimeType =
    asNonEmptyString(block.mimeType) ??
    asNonEmptyString(block.media_type) ??
    asNonEmptyString(source?.media_type) ??
    asNonEmptyString(source?.mimeType) ??
    (dataUrl ? mimeFromDataUrl(dataUrl) : undefined);
  const explicitSize = block.sizeBytes ?? source?.sizeBytes;
  const sizeBytes =
    typeof explicitSize === "number" && Number.isFinite(explicitSize) && explicitSize >= 0
      ? Math.floor(explicitSize)
      : base64?.sizeBytes;
  if (base64) {
    return {
      mode: "bytes",
      ...(base64.data ? { data: base64.data } : {}),
      mimeType,
      sizeBytes,
    };
  }
  if (remoteUrl) {
    return { mode: "url", url: remoteUrl, mimeType, sizeBytes };
  }
  return { mode: "unsupported", mimeType, sizeBytes };
}

export async function resolveManagedOutgoingArtifactDownload(
  artifact: ArtifactRecord,
  opts: { sessionKey: string; stateDir: string },
): Promise<{ artifact: ArtifactRecord; data: string } | null> {
  if (artifact.download.mode !== "url" || !artifact.url) {
    return null;
  }
  const readManagedOutgoingImageDownloadUrl = await loadReadManagedOutgoingImageDownloadUrl();
  const download = await readManagedOutgoingImageDownloadUrl({
    url: artifact.url,
    expectedSessionKey: opts.sessionKey,
    stateDir: opts.stateDir,
  });
  if (!download) {
    return null;
  }
  const data = download.data.toString("base64");
  return {
    artifact: {
      ...artifact,
      mimeType: download.contentType,
      sizeBytes: download.sizeBytes,
      download: { mode: "bytes" },
      data,
    },
    data,
  };
}
