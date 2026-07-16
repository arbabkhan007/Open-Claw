// Line plugin module implements download behavior.
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { setTimeout as delay } from "node:timers/promises";
import { saveMediaStream } from "openclaw/plugin-sdk/media-store";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { fetchWithRuntimeDispatcherOrMockedGlobal } from "openclaw/plugin-sdk/runtime-fetch";

interface DownloadResult {
  path: string;
  contentType?: string;
  size: number;
}

// LINE prepares inbound media asynchronously. Poll the content endpoint itself
// because the transcoding-status endpoint does not cover every media type.
const CONTENT_READY_MAX_ATTEMPTS = 6;
const CONTENT_READY_BASE_DELAY_MS = 500;
const CONTENT_READY_MAX_DELAY_MS = 4000;
// Readiness polls only (202 → retry). Large video/audio may prepare for a while
// on api-data.line.me; do not spend this budget on body transfer.
const CONTENT_READY_TIMEOUT_MS = 15_000;
// Body wall-clock after HTTP 200. Aligned with Slack/Feishu inbound media totals
// so late readiness still gets a full transfer budget for the default 10MB cap.
const LINE_MEDIA_BODY_TIMEOUT_MS = 120_000;
const LINE_CONTENT_BASE_URL = "https://api-data.line.me/v2/bot/message";

function contentBackoffDelayMs(attempt: number): number {
  return Math.min(CONTENT_READY_BASE_DELAY_MS * 2 ** attempt, CONTENT_READY_MAX_DELAY_MS);
}

function resolvePositiveTimeoutMs(timeoutMs: number | undefined, fallbackMs: number): number {
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.floor(timeoutMs);
  }
  return fallbackMs;
}

function formatLineMediaReadyTimeoutError(
  messageId: string,
  timeoutMs: number,
  cause?: unknown,
): Error {
  return new Error(
    `LINE media for message ${messageId} did not become ready within ${timeoutMs / 1000} seconds`,
    cause === undefined ? undefined : { cause },
  );
}

function formatLineMediaBodyTimeoutError(
  messageId: string,
  timeoutMs: number,
  cause?: unknown,
): Error {
  return new Error(
    `LINE media body for message ${messageId} timed out after ${timeoutMs / 1000} seconds`,
    cause === undefined ? undefined : { cause },
  );
}

async function fetchLineContentWhenReady(
  messageId: string,
  channelAccessToken: string,
  signal: AbortSignal,
  contentBaseUrl: string,
): Promise<Readable> {
  for (let attempt = 0; attempt < CONTENT_READY_MAX_ATTEMPTS; attempt++) {
    const response = await fetchWithRuntimeDispatcherOrMockedGlobal(
      `${contentBaseUrl}/${encodeURIComponent(messageId)}/content`,
      {
        headers: { Authorization: `Bearer ${channelAccessToken}` },
        redirect: "error",
        signal,
      },
    );
    if (response.status === 200) {
      if (!response.body) {
        throw new Error(`LINE media response for message ${messageId} had no body`);
      }
      // Readiness deadline ends here; caller owns a separate body wall-clock.
      return Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
    }

    await response.body?.cancel();
    if (response.status !== 202) {
      throw new Error(
        `LINE media download failed for message ${messageId} (HTTP ${response.status})`,
      );
    }
    if (attempt < CONTENT_READY_MAX_ATTEMPTS - 1) {
      await delay(contentBackoffDelayMs(attempt), undefined, { signal });
    }
  }

  throw new Error(
    `LINE media for message ${messageId} was still preparing (HTTP 202) after ${CONTENT_READY_MAX_ATTEMPTS} attempts`,
  );
}

export async function downloadLineMedia(
  messageId: string,
  channelAccessToken: string,
  maxBytes = 10 * 1024 * 1024,
  options?: {
    originalFilename?: string;
    timeoutMs?: number;
    bodyTimeoutMs?: number;
    contentBaseUrl?: string;
  },
): Promise<DownloadResult> {
  const readyTimeoutMs = resolvePositiveTimeoutMs(options?.timeoutMs, CONTENT_READY_TIMEOUT_MS);
  const bodyTimeoutMs = resolvePositiveTimeoutMs(
    options?.bodyTimeoutMs,
    LINE_MEDIA_BODY_TIMEOUT_MS,
  );
  const contentBaseUrl =
    typeof options?.contentBaseUrl === "string" && options.contentBaseUrl.trim()
      ? options.contentBaseUrl.replace(/\/+$/, "")
      : LINE_CONTENT_BASE_URL;

  const readyController = new AbortController();
  const readyDeadline = setTimeout(() => readyController.abort(), readyTimeoutMs);
  readyDeadline.unref();
  let content: Readable | undefined;
  try {
    try {
      content = await fetchLineContentWhenReady(
        messageId,
        channelAccessToken,
        readyController.signal,
        contentBaseUrl,
      );
    } catch (err) {
      if (readyController.signal.aborted) {
        throw formatLineMediaReadyTimeoutError(messageId, readyTimeoutMs, err);
      }
      throw err;
    } finally {
      clearTimeout(readyDeadline);
    }

    const bodyController = new AbortController();
    const bodyDeadline = setTimeout(() => bodyController.abort(), bodyTimeoutMs);
    bodyDeadline.unref();
    const onAbort = () => {
      content?.destroy(formatLineMediaBodyTimeoutError(messageId, bodyTimeoutMs));
    };
    try {
      if (bodyController.signal.aborted) {
        onAbort();
      } else {
        bodyController.signal.addEventListener("abort", onAbort, { once: true });
      }
      let saved: Awaited<ReturnType<typeof saveMediaStream>>;
      try {
        saved = await saveMediaStream(
          content,
          undefined,
          "inbound",
          maxBytes,
          options?.originalFilename,
        );
      } finally {
        bodyController.signal.removeEventListener("abort", onAbort);
      }
      logVerbose(`line: persisted media ${messageId} to ${saved.path} (${saved.size} bytes)`);

      return {
        path: saved.path,
        contentType: saved.contentType,
        size: saved.size,
      };
    } catch (err) {
      if (bodyController.signal.aborted) {
        throw formatLineMediaBodyTimeoutError(messageId, bodyTimeoutMs, err);
      }
      throw err;
    } finally {
      clearTimeout(bodyDeadline);
    }
  } catch (err) {
    if (content) {
      content.destroy();
      await finished(content).catch(() => undefined);
    }
    throw err;
  }
}
