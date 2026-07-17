const MANAGED_OUTGOING_IMAGE_ROUTE_PREFIX = "/api/chat/media/outgoing";
const MANAGED_OUTGOING_ATTACHMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManagedOutgoingImageRoute = {
  sessionKey: string;
  attachmentId: string;
};

export function buildManagedOutgoingImageRoute(sessionKey: string, attachmentId: string): string {
  return `${MANAGED_OUTGOING_IMAGE_ROUTE_PREFIX}/${encodeURIComponent(sessionKey)}/${attachmentId}/full`;
}

export function parseManagedOutgoingImageRoute(pathname: string): ManagedOutgoingImageRoute | null {
  const match = pathname.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\/([^/]+)\/full$/);
  const encodedSessionKey = match?.[1];
  const attachmentId = match?.[2];
  if (
    !encodedSessionKey ||
    !attachmentId ||
    !MANAGED_OUTGOING_ATTACHMENT_ID_RE.test(attachmentId)
  ) {
    return null;
  }
  try {
    return { sessionKey: decodeURIComponent(encodedSessionKey), attachmentId };
  } catch {
    return null;
  }
}

export function parseManagedOutgoingImageUrl(value: string): ManagedOutgoingImageRoute | null {
  try {
    return parseManagedOutgoingImageRoute(new URL(value, "http://localhost").pathname);
  } catch {
    return null;
  }
}

export function parseManagedOutgoingImageRelativeUrl(
  value: string,
): ManagedOutgoingImageRoute | null {
  const trimmed = value.trim();
  return trimmed.startsWith(`${MANAGED_OUTGOING_IMAGE_ROUTE_PREFIX}/`)
    ? parseManagedOutgoingImageUrl(trimmed)
    : null;
}
