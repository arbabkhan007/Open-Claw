import type {
  ArtifactsDownloadResult,
  ArtifactsListResult,
} from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";

export type ManagedOutgoingImageRequest = {
  source: string;
  sessionKey: string;
  agentId?: string;
  messageSeq: number;
  contentIndex: number;
};

export type ManagedOutgoingImageResolver = (
  request: ManagedOutgoingImageRequest,
) => Promise<Blob | null>;

export class ManagedOutgoingImageResolverController<TScope> {
  private scope: TScope | null = null;
  private resolver: ManagedOutgoingImageResolver | undefined;

  constructor(
    private readonly isCurrent: (scope: TScope) => boolean,
    private readonly clientFor: (scope: TScope) => GatewayBrowserClient,
  ) {}

  get current(): ManagedOutgoingImageResolver | undefined {
    return this.resolver;
  }

  clear(): void {
    if (this.resolver) {
      clearManagedOutgoingImagePreviewCache(this.resolver);
    }
    this.scope = null;
    this.resolver = undefined;
  }

  refresh(scope: TScope | null, supported: boolean): void {
    if (!scope || !supported) {
      this.clear();
      return;
    }
    if (this.resolver && this.scope && this.isCurrent(this.scope)) {
      return;
    }
    this.clear();
    this.scope = scope;
    this.resolver = async (request) => {
      if (!this.isCurrent(scope)) {
        return null;
      }
      const blob = await downloadManagedOutgoingImagePreview(this.clientFor(scope), request);
      return this.isCurrent(scope) ? blob : null;
    };
  }
}

type ManagedImageBlobUrlCache = {
  disposed: boolean;
  pending: Map<string, Promise<string | null>>;
  resolved: Map<string, string>;
  misses: Map<string, number>;
};

const managedImageBlobUrlCaches = new WeakMap<
  ManagedOutgoingImageResolver,
  ManagedImageBlobUrlCache
>();
const MANAGED_IMAGE_BLOB_URL_MISS_RETRY_MS = 5_000;

function blobUrlCacheFor(resolver: ManagedOutgoingImageResolver): ManagedImageBlobUrlCache {
  let cache = managedImageBlobUrlCaches.get(resolver);
  if (!cache) {
    cache = { disposed: false, pending: new Map(), resolved: new Map(), misses: new Map() };
    managedImageBlobUrlCaches.set(resolver, cache);
  }
  return cache;
}

function clearManagedOutgoingImagePreviewCache(resolver: ManagedOutgoingImageResolver): void {
  const cache = managedImageBlobUrlCaches.get(resolver);
  if (!cache) {
    return;
  }
  cache.disposed = true;
  for (const blobUrl of cache.resolved.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  cache.pending.clear();
  cache.resolved.clear();
  cache.misses.clear();
  managedImageBlobUrlCaches.delete(resolver);
}

export function resolveManagedOutgoingImageBlobUrl(
  resolver: ManagedOutgoingImageResolver,
  request: ManagedOutgoingImageRequest,
): Promise<string | null> {
  const cache = blobUrlCacheFor(resolver);
  const cacheKey = `${request.source}::${request.messageSeq}:${request.contentIndex}`;
  const cached = cache.resolved.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  const missAt = cache.misses.get(cacheKey);
  if (missAt && Date.now() - missAt < MANAGED_IMAGE_BLOB_URL_MISS_RETRY_MS) {
    return Promise.resolve(null);
  }
  const existing = cache.pending.get(cacheKey);
  if (existing) {
    return existing;
  }
  const pending = resolver(request)
    .then((blob) => {
      if (!blob || !blob.type.startsWith("image/") || cache.disposed) {
        cache.misses.set(cacheKey, Date.now());
        return null;
      }
      const blobUrl = URL.createObjectURL(blob);
      cache.resolved.set(cacheKey, blobUrl);
      cache.misses.delete(cacheKey);
      return blobUrl;
    })
    .catch(() => {
      cache.misses.set(cacheKey, Date.now());
      return null;
    })
    .finally(() => cache.pending.delete(cacheKey));
  cache.pending.set(cacheKey, pending);
  return pending;
}

const pendingArtifactLists = new WeakMap<
  GatewayBrowserClient,
  Map<string, Promise<ArtifactsListResult>>
>();

export function isManagedOutgoingImageSource(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.startsWith("/api/chat/media/outgoing/")) {
    return true;
  }
  try {
    const origin = globalThis.location?.origin;
    if (!origin) {
      return false;
    }
    const parsed = new URL(trimmed, origin);
    return parsed.origin === origin && parsed.pathname.startsWith("/api/chat/media/outgoing/");
  } catch {
    return false;
  }
}

export function needsManagedOutgoingImageCoordinateReload(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as Record<string, unknown>;
  const metadata = record["__openclaw"] as Record<string, unknown> | undefined;
  if (typeof metadata?.seq === "number" && Number.isSafeInteger(metadata.seq) && metadata.seq > 0) {
    return false;
  }
  if (!Array.isArray(record.content)) {
    return false;
  }
  return record.content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const entry = block as Record<string, unknown>;
    if (entry.type === "image" && typeof entry.url === "string") {
      return isManagedOutgoingImageSource(entry.url);
    }
    if (entry.type !== "image_url" || !entry.image_url || typeof entry.image_url !== "object") {
      return false;
    }
    const imageUrl = (entry.image_url as Record<string, unknown>).url;
    return typeof imageUrl === "string" && isManagedOutgoingImageSource(imageUrl);
  });
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function listArtifacts(
  client: GatewayBrowserClient,
  query: { sessionKey: string; agentId?: string },
): Promise<ArtifactsListResult> {
  let clientLists = pendingArtifactLists.get(client);
  if (!clientLists) {
    clientLists = new Map();
    pendingArtifactLists.set(client, clientLists);
  }
  const scopeKey = `${query.sessionKey}\0${query.agentId ?? ""}`;
  const existing = clientLists.get(scopeKey);
  if (existing) {
    return existing;
  }
  const pending = client.request<ArtifactsListResult>("artifacts.list", query).finally(() => {
    if (clientLists.get(scopeKey) === pending) {
      clientLists.delete(scopeKey);
      if (clientLists.size === 0) {
        pendingArtifactLists.delete(client);
      }
    }
  });
  clientLists.set(scopeKey, pending);
  return pending;
}

async function downloadManagedOutgoingImagePreview(
  client: GatewayBrowserClient,
  request: ManagedOutgoingImageRequest,
): Promise<Blob | null> {
  const query = {
    sessionKey: request.sessionKey,
    ...(request.agentId ? { agentId: request.agentId } : {}),
  };
  const list = await listArtifacts(client, query);
  const artifact = list.artifacts.find(
    (candidate) =>
      candidate.messageSeq === request.messageSeq &&
      candidate.contentIndex === request.contentIndex &&
      candidate.type === "image" &&
      candidate.download.mode === "url",
  );
  if (!artifact) {
    return null;
  }
  const download = await client.request<ArtifactsDownloadResult>("artifacts.download", {
    ...query,
    artifactId: artifact.id,
  });
  const mimeType = download.artifact.mimeType?.trim().toLowerCase() ?? "";
  if (
    download.artifact.id !== artifact.id ||
    download.encoding !== "base64" ||
    !download.data ||
    !mimeType.startsWith("image/")
  ) {
    return null;
  }
  const bytes = decodeBase64(download.data);
  return bytes ? new Blob([bytes], { type: mimeType }) : null;
}
