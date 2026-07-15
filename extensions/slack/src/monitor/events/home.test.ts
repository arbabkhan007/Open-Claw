// Slack tests cover home plugin behavior.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile }));

let buildSlackHomeView: typeof import("./home.js").buildSlackHomeView;
let registerSlackHomeEvents: typeof import("./home.js").registerSlackHomeEvents;
let createSlackSystemEventTestHarness: typeof import("./system-event-test-harness.js").createSlackSystemEventTestHarness;

type HomeHandler = (args: { event: Record<string, unknown>; body: unknown }) => Promise<void>;

function createHomeContext(params?: {
  slashCommandName?: string;
  trackEvent?: () => void;
  shouldDropMismatchedSlackEvent?: (body: unknown) => boolean;
  slackConfig?: Record<string, unknown>;
}) {
  const harness = createSlackSystemEventTestHarness();
  const publish = vi.fn().mockResolvedValue({ ok: true });
  const runtimeError = vi.fn();
  if (params?.shouldDropMismatchedSlackEvent) {
    harness.ctx.shouldDropMismatchedSlackEvent = params.shouldDropMismatchedSlackEvent;
  }
  harness.ctx.cfg = {
    channels: {
      slack: {
        ...(params?.slackConfig ?? {}),
      },
    },
  } as typeof harness.ctx.cfg;
  harness.ctx.botToken = "xoxb-test";
  harness.ctx.accountId = "default";
  harness.ctx.runtime.error = runtimeError;
  (harness.ctx.app as unknown as { client: { views: { publish: typeof publish } } }).client = {
    views: { publish },
  };
  registerSlackHomeEvents({
    ctx: harness.ctx,
    slashCommandName: params?.slashCommandName,
    trackEvent: params?.trackEvent,
  });
  return {
    publish,
    runtimeError,
    getHomeHandler: () => harness.getHandler("app_home_opened") as HomeHandler | null,
  };
}

describe("registerSlackHomeEvents", () => {
  beforeAll(async () => {
    ({ buildSlackHomeView, registerSlackHomeEvents } = await import("./home.js"));
    ({ createSlackSystemEventTestHarness } = await import("./system-event-test-harness.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockReset();
  });

  it("publishes the Home tab without an inactive slash command hint", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({ trackEvent });
    const handler = getHomeHandler();
    if (!handler) {
      throw new Error("expected Slack Home handler");
    }

    await handler({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
        event_ts: "123.456",
      },
      body: { api_app_id: "A1" },
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: expect.any(Object),
    });
    expect(publish.mock.calls[0]?.[0]?.view.blocks[1]).toMatchObject({
      type: "section",
      text: {
        text: "Send a DM or mention OpenClaw in a channel to start a session.",
      },
    });
  });

  it("publishes the configured slash command name", async () => {
    const { publish, getHomeHandler } = createHomeContext({ slashCommandName: "acme" });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
      },
      body: {},
    });

    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: expect.any(Object),
    });
    expect(publish.mock.calls[0]?.[0]?.view.blocks[1]).toMatchObject({
      type: "section",
      text: {
        text: "Send a DM, mention OpenClaw in a channel, or use `/acme` to start a session.",
      },
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("publishes the configured inline Home tab view", async () => {
    const customView = {
      type: "home",
      callback_id: "custom-home-v1",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Welcome" } }],
    };
    const { publish, getHomeHandler } = createHomeContext({
      slackConfig: { appHome: { view: customView } },
    });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
      },
      body: {},
    });

    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: customView,
    });
  });

  it("loads a configured Home tab view path each time Slack opens the tab", async () => {
    const firstView = {
      type: "home",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "First" } }],
    };
    const secondView = {
      type: "home",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Second" } }],
    };
    readFile
      .mockResolvedValueOnce(JSON.stringify(firstView))
      .mockResolvedValueOnce(JSON.stringify(secondView));
    const { publish, getHomeHandler } = createHomeContext({
      slackConfig: { appHome: { viewPath: "/etc/openclaw/slack-home.json" } },
    });
    const handler = getHomeHandler()!;

    for (const user of ["U123", "U456"]) {
      await handler({
        event: {
          type: "app_home_opened",
          user,
          channel: "D123",
          tab: "home",
        },
        body: {},
      });
    }

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenNthCalledWith(1, "/etc/openclaw/slack-home.json", "utf-8");
    expect(readFile).toHaveBeenNthCalledWith(2, "/etc/openclaw/slack-home.json", "utf-8");
    expect(publish).toHaveBeenNthCalledWith(1, {
      token: "xoxb-test",
      user_id: "U123",
      view: firstView,
    });
    expect(publish).toHaveBeenNthCalledWith(2, {
      token: "xoxb-test",
      user_id: "U456",
      view: secondView,
    });
  });

  it("passes unknown Home tab blocks through up to Slack's 100 block limit", async () => {
    const blocks = Array.from({ length: 100 }, (_, index) => ({
      type: "future_block",
      block_id: `block-${index}`,
    }));
    const customView = {
      type: "home",
      callback_id: "future-home-v1",
      blocks,
    };
    const { publish, getHomeHandler } = createHomeContext({
      slackConfig: { appHome: { view: customView } },
    });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
      },
      body: {},
    });

    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: customView,
    });
  });

  it("logs invalid configured views and publishes the default fallback", async () => {
    const { publish, runtimeError, getHomeHandler } = createHomeContext({
      slackConfig: { appHome: { view: { type: "modal", blocks: [] } } },
    });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
      },
      body: {},
    });

    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: buildSlackHomeView(),
    });
    expect(runtimeError).toHaveBeenCalledOnce();
    expect(String(runtimeError.mock.calls[0]?.[0])).toContain("slack app home view config failed");
  });

  it("does not publish when Slack reports the Messages tab", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({ trackEvent });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "messages",
      },
      body: {},
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not track or publish mismatched events", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({
      trackEvent,
      shouldDropMismatchedSlackEvent: () => true,
    });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        tab: "home",
      },
      body: { api_app_id: "A_OTHER" },
    });

    expect(trackEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
