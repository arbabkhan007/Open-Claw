// Qqbot plugin module implements ws client behavior.
import type { Agent } from "node:http";
import { resolveAmbientNodeProxyAgent } from "openclaw/plugin-sdk/extension-shared";
import WebSocket from "ws";

// `ws` otherwise waits indefinitely for an HTTP upgrade. Keep the 30s channel
// precedent (Discord, Slack, Signal) so a half-open upgrade eventually closes,
// releases GatewayConnection.isConnecting, and allows reconnects.
const QQBOT_WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 30_000;

// Bound inbound gateway frames at 1 MiB so a single overgrown payload cannot
// pin memory before JSON.parse. QQ Bot gateway frames are JSON envelopes only —
// media and file attachments travel through HTTP upload APIs, never the
// WebSocket. The largest valid inbound event (GROUP_AT_MESSAGE_CREATE carrying
// attached message content, mentions, msg_elements, and metadata) stays well
// under 1 MiB. This follows the JSON-only channel precedent: Slack, Signal, and
// Mattermost all use the same 1 MiB cap for their gateway WebSocket clients.
const QQBOT_WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;

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
