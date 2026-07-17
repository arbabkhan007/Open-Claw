// Qqbot plugin module implements ws client behavior.
import type { Agent } from "node:http";
import { resolveAmbientNodeProxyAgent } from "openclaw/plugin-sdk/extension-shared";
import WebSocket from "ws";

// `ws` otherwise waits indefinitely for an HTTP upgrade. Keep the 30s channel
// precedent (Discord, Slack, Signal) so a half-open upgrade eventually closes,
// releases GatewayConnection.isConnecting, and allows reconnects.
const QQBOT_WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 30_000;

// Bound inbound gateway frames so a single overgrown payload cannot pin memory
// before JSON.parse. QQ Bot gateway frames are JSON envelopes; media and file
// attachments are URL metadata rather than inline binary. Keep the larger
// Mattermost channel precedent to preserve headroom for unusually large valid
// JSON events while still replacing ws's 100 MiB default.
const QQBOT_WEBSOCKET_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

interface QQWSClientOptions {
  gatewayUrl: string;
  userAgent: string;
}

export async function createQQWSClient(options: QQWSClientOptions): Promise<WebSocket> {
  const wsAgent = await resolveAmbientNodeProxyAgent<Agent>();
  return new WebSocket(options.gatewayUrl, {
    headers: { "User-Agent": options.userAgent },
    handshakeTimeout: QQBOT_WEBSOCKET_HANDSHAKE_TIMEOUT_MS,
    maxPayload: QQBOT_WEBSOCKET_MAX_PAYLOAD_BYTES,
    ...(wsAgent ? { agent: wsAgent } : {}),
  });
}
