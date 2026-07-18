// Control UI chat module implements realtime talk behavior.
import { normalizeTalkTransport } from "../../../../src/talk/talk-session-controller.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { GatewayRelayRealtimeTalkTransport } from "./realtime-talk-gateway-relay.ts";
import { GoogleLiveRealtimeTalkTransport } from "./realtime-talk-google-live.ts";
import type {
  RealtimeTalkCallbacks,
  RealtimeTalkGatewayRelaySessionResult,
  RealtimeTalkJsonPcmWebSocketSessionResult,
  RealtimeTalkSessionResult,
  RealtimeTalkStatus,
  RealtimeTalkTransport,
  RealtimeTalkTransportContext,
  RealtimeTalkWebRtcSdpSessionResult,
} from "./realtime-talk-shared.ts";
import { WebRtcSdpRealtimeTalkTransport } from "./realtime-talk-webrtc.ts";

export type { RealtimeTalkStatus };

type RealtimeTalkLaunchOptions = {
  provider?: string;
  model?: string;
  voice?: string;
  transport?: "webrtc" | "provider-websocket" | "gateway-relay" | "managed-room";
  vadThreshold?: number;
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
  reasoningEffort?: string;
  capabilities?: Array<"camera-frame">;
};

type RealtimeTalkLocalOptions = {
  inputDeviceId?: string;
  videoEnabled?: boolean;
};

type RealtimeTalkLaunchTransport = NonNullable<RealtimeTalkLaunchOptions["transport"]>;

type RealtimeTalkConfigResult = {
  config?: {
    talk?: {
      realtime?: {
        transport?: unknown;
      };
    };
  };
};

function normalizeLaunchTransport(value: unknown): RealtimeTalkLaunchTransport | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const transport = normalizeTalkTransport(value);
  if (
    transport === "webrtc" ||
    transport === "provider-websocket" ||
    transport === "gateway-relay" ||
    transport === "managed-room"
  ) {
    return transport;
  }
  return undefined;
}

function createTransport(
  session: RealtimeTalkSessionResult,
  ctx: RealtimeTalkTransportContext,
): RealtimeTalkTransport {
  const transport = resolveTransport(session);
  if (transport === "webrtc") {
    return new WebRtcSdpRealtimeTalkTransport(session as RealtimeTalkWebRtcSdpSessionResult, ctx);
  }
  if (transport === "provider-websocket") {
    return new GoogleLiveRealtimeTalkTransport(
      session as RealtimeTalkJsonPcmWebSocketSessionResult,
      ctx,
    );
  }
  if (transport === "gateway-relay") {
    return new GatewayRelayRealtimeTalkTransport(
      session as RealtimeTalkGatewayRelaySessionResult,
      ctx,
    );
  }
  if (transport === "managed-room") {
    throw new Error("Managed-room realtime Talk sessions are not available in this UI yet");
  }
  const unknownTransport = (session as { transport?: string }).transport ?? "unknown";
  throw new Error(`Unsupported realtime Talk transport: ${unknownTransport}`);
}

function resolveTransport(session: RealtimeTalkSessionResult): string {
  return normalizeTalkTransport((session as { transport?: string }).transport) ?? "webrtc";
}

function compactLaunchParams(
  params: RealtimeTalkLaunchOptions & { sessionKey: string; mode?: string; brain?: string },
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export class RealtimeTalkSession {
  private transport: RealtimeTalkTransport | null = null;
  private closed = false;
  private lifecycleGeneration = 0;

  constructor(
    private readonly client: GatewayBrowserClient,
    private readonly sessionKey: string,
    private readonly callbacks: RealtimeTalkCallbacks = {},
    private readonly options: RealtimeTalkLaunchOptions = {},
    private readonly localOptions: RealtimeTalkLocalOptions = {},
  ) {}

  async start(): Promise<void> {
    const generation = ++this.lifecycleGeneration;
    this.closed = false;
    this.callbacks.onStatus?.("connecting");
    const session = await this.createSession();
    const transportContext = {
      client: this.client,
      sessionKey: this.sessionKey,
      callbacks: this.callbacks,
      inputDeviceId: this.localOptions.inputDeviceId,
      videoEnabled: this.localOptions.videoEnabled,
      consultThinkingLevel: session.consultThinkingLevel,
      consultFastMode: session.consultFastMode,
    };
    if (this.closed || generation !== this.lifecycleGeneration) {
      // Gateway relay creation allocates server state before returning. A late
      // result still owns its close RPC after stop or a replacement start.
      if (resolveTransport(session) === "gateway-relay") {
        createTransport(session, transportContext).stop();
      }
      return;
    }
    this.transport = createTransport(session, transportContext);
    await this.transport.start();
  }

  private async createSession(): Promise<RealtimeTalkSessionResult> {
    try {
      return await this.client.request<RealtimeTalkSessionResult>(
        "talk.client.create",
        compactLaunchParams({
          sessionKey: this.sessionKey,
          ...this.options,
        }),
      );
    } catch (error) {
      let transport = this.options.transport;
      if (!transport) {
        let result: RealtimeTalkConfigResult;
        try {
          result = await this.client.request<RealtimeTalkConfigResult>("talk.config", {});
        } catch {
          throw error;
        }
        if (!result.config || typeof result.config !== "object") {
          throw error;
        }
        const configuredTransport = result.config?.talk?.realtime?.transport;
        if (configuredTransport !== undefined) {
          transport = normalizeLaunchTransport(configuredTransport);
          if (!transport) {
            throw error;
          }
        }
      }
      if (transport && transport !== "gateway-relay") {
        throw error;
      }
      try {
        return await this.client.request<RealtimeTalkSessionResult>(
          "talk.session.create",
          compactLaunchParams({
            sessionKey: this.sessionKey,
            ...this.options,
            mode: "realtime",
            transport: transport ?? "gateway-relay",
            brain: "agent-consult",
          }),
        );
      } catch {
        throw error;
      }
    }
  }

  stop(): void {
    this.lifecycleGeneration += 1;
    this.closed = true;
    this.callbacks.onStatus?.("idle");
    this.transport?.stop();
    this.transport = null;
  }
}
