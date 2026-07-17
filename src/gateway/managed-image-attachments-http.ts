// HTTP serving for managed outgoing image attachments.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readLocalFileSafely } from "../infra/fs-safe.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson, sendMethodNotAllowed, sendMissingScopeForbidden } from "./http-common.js";
import {
  authorizeGatewayHttpRequestOrReply,
  resolveOpenAiCompatibleHttpOperatorScopes,
  resolveOpenAiCompatibleHttpSenderIsOwner,
} from "./http-utils.js";
import { parseManagedOutgoingImageRoute } from "./managed-image-attachment-route.js";
import { recordMatchesTranscriptMessage } from "./managed-image-attachments.js";
import {
  readManagedImageRecord,
  resolveManagedImageOriginalPath,
} from "./managed-image-record-store.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

function sendStatus(res: ServerResponse, statusCode: number, body: string) {
  if (res.writableEnded) {
    return;
  }
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

function safeAttachmentFilename(value: string | null) {
  const fallback = "generated-image";
  const base = (value ?? fallback).replace(/[\r\n"\\]/g, "_").trim();
  return base || fallback;
}

export async function handleManagedOutgoingImageHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
    stateDir?: string;
  },
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const matchesRouteShape = /^\/api\/chat\/media\/outgoing\/([^/]+)\/([^/]+)\/full$/.test(
    requestUrl.pathname,
  );
  if (!matchesRouteShape) {
    return false;
  }

  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }

  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!requestAuth) {
    return true;
  }

  const requestedScopes = resolveOpenAiCompatibleHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("chat.history", requestedScopes);
  if (!scopeAuth.allowed) {
    sendMissingScopeForbidden(res, scopeAuth.missingScope);
    return true;
  }

  const route = parseManagedOutgoingImageRoute(requestUrl.pathname);
  if (!route) {
    sendStatus(res, 404, "not found");
    return true;
  }
  const record = readManagedImageRecord(route.attachmentId, opts.stateDir);
  if (!record || record.sessionKey !== route.sessionKey) {
    sendStatus(res, 404, "not found");
    return true;
  }
  // Requester-session headers are client-declared, so media bytes require an
  // authenticated owner/admin context; never trust the URL-scoped session header.
  const ownerAllowed = resolveOpenAiCompatibleHttpSenderIsOwner(req, requestAuth);
  if (!ownerAllowed) {
    sendJson(res, 403, {
      ok: false,
      error: {
        type: "forbidden",
        message: "owner access required",
      },
    });
    return true;
  }
  if (!(await recordMatchesTranscriptMessage(record))) {
    sendStatus(res, 404, "not found");
    return true;
  }

  let body: Buffer;
  try {
    body = (await readLocalFileSafely({ filePath: resolveManagedImageOriginalPath(record) }))
      .buffer;
  } catch {
    sendStatus(res, 404, "not found");
    return true;
  }

  res.statusCode = 200;
  res.setHeader("content-type", record.original.contentType || "application/octet-stream");
  res.setHeader("content-length", String(body.byteLength));
  res.setHeader("cache-control", "private, max-age=31536000, immutable");
  res.setHeader(
    "content-disposition",
    `inline; filename="${safeAttachmentFilename(record.original.filename)}"`,
  );
  res.end(body);
  return true;
}
