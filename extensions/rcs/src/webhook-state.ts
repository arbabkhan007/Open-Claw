import { createChannelReplayGuard } from "openclaw/plugin-sdk/persistent-dedupe";
import { createFixedWindowRateLimiter } from "openclaw/plugin-sdk/webhook-ingress";

const INBOUND_IP_RATE_LIMIT_PER_MINUTE = 600;
const INBOUND_SENDER_RATE_LIMIT_PER_MINUTE = 30;
const REPLAY_CACHE_TTL_MS = 10 * 60_000;
const REPLAY_CACHE_MAX_KEYS = 10_000;

type RcsWebhookReplayEvent = {
  accountId: string;
  messageSid: string;
};

export type RcsWebhookRateLimiter = ReturnType<typeof createFixedWindowRateLimiter>;

export function createInboundIpRateLimiter(): RcsWebhookRateLimiter {
  return createFixedWindowRateLimiter({
    maxRequests: INBOUND_IP_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
    maxTrackedKeys: 5_000,
  });
}

export function createInboundSenderRateLimiter(): RcsWebhookRateLimiter {
  return createFixedWindowRateLimiter({
    maxRequests: INBOUND_SENDER_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
    maxTrackedKeys: 10_000,
  });
}

export function createStatusRateLimiter(): RcsWebhookRateLimiter {
  return createFixedWindowRateLimiter({
    maxRequests: 120,
    windowMs: 60_000,
    maxTrackedKeys: 5_000,
  });
}

function createRcsWebhookReplayGuard() {
  return createChannelReplayGuard<RcsWebhookReplayEvent>({
    dedupe: {
      ttlMs: REPLAY_CACHE_TTL_MS,
      memoryMaxSize: REPLAY_CACHE_MAX_KEYS,
      pluginId: "rcs",
      namespacePrefix: "rcs-webhook-replay",
      stateMaxEntries: REPLAY_CACHE_MAX_KEYS,
    },
    buildReplayKey: (event) => event.messageSid,
    namespace: (event) => event.accountId,
  });
}

export type RcsWebhookReplayGuard = ReturnType<typeof createRcsWebhookReplayGuard>;

export const rcsWebhookReplayGuard = createRcsWebhookReplayGuard();
