// Verifies default config values and environment-sensitive overrides.
import { expectDefined } from "@openclaw/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_MAX_CONCURRENT,
  DEFAULT_SUBAGENT_ARCHIVE_AFTER_MINUTES,
  DEFAULT_SUBAGENT_MAX_CONCURRENT,
} from "./agent-limits.js";
import { DEFAULT_CRON_MAX_CONCURRENT_RUNS } from "./cron-limits.js";
import {
  applyAgentDefaults,
  applyContextPruningDefaults,
  applyCronDefaults,
  applyMessageDefaults,
  applyModelDefaults,
  resolveNormalizedProviderModelMaxTokens,
} from "./defaults.js";

const mocks = vi.hoisted(() => ({
  applyProviderConfigDefaultsForConfig: vi.fn(),
}));

vi.mock("./provider-policy.js", () => ({
  applyProviderConfigDefaultsForConfig: (
    ...args: Parameters<typeof mocks.applyProviderConfigDefaultsForConfig>
  ) => mocks.applyProviderConfigDefaultsForConfig(...args),
  normalizeProviderConfigForConfigDefaults: (_params: { providerConfig: unknown }) =>
    _params.providerConfig,
}));

describe("config defaults", () => {
  beforeEach(() => {
    mocks.applyProviderConfigDefaultsForConfig.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips provider defaults when agent defaults are absent", () => {
    const cfg = {
      models: {
        providers: {
          openai: {
            api: "openai-completions",
          },
        },
      },
    };

    expect(applyContextPruningDefaults(cfg as never)).toBe(cfg);
    expect(mocks.applyProviderConfigDefaultsForConfig).not.toHaveBeenCalled();
  });

  it("skips provider defaults when agent defaults have no Anthropic auth signal", () => {
    const cfg = {
      agents: {
        defaults: {},
      },
    };

    expect(applyContextPruningDefaults(cfg as never)).toBe(cfg);
    expect(mocks.applyProviderConfigDefaultsForConfig).not.toHaveBeenCalled();
  });

  it("uses anthropic provider defaults when agent defaults and auth signal exist", () => {
    const cfg = {
      auth: {
        profiles: {
          anthropic: { provider: "anthropic", mode: "api_key" },
        },
      },
      agents: {
        defaults: {},
      },
    };
    const nextCfg = {
      agents: {
        defaults: {
          contextPruning: {
            mode: "cache-ttl",
          },
        },
      },
    };
    mocks.applyProviderConfigDefaultsForConfig.mockReturnValue(nextCfg);

    const manifestRegistry = { plugins: [] };
    expect(applyContextPruningDefaults(cfg as never, { manifestRegistry })).toBe(nextCfg);
    expect(mocks.applyProviderConfigDefaultsForConfig).toHaveBeenCalledTimes(1);
    const [defaultsParams] = expectDefined(
      (
        mocks.applyProviderConfigDefaultsForConfig.mock.calls as unknown as Array<
          [{ manifestRegistry?: unknown }]
        >
      )[0],
      "(mocks.applyProviderConfigDefaultsForConfig.mock.calls as unknown as Array<\n        [{ manifestRegistry?: unknown }]\n      >)[0] test invariant",
    );
    expect(defaultsParams.manifestRegistry).toBe(manifestRegistry);
  });

  it("defaults ackReactionScope without deriving other message fields", () => {
    const next = applyMessageDefaults({
      agents: {
        list: [
          {
            id: "main",
            identity: {
              name: "Samantha",
              theme: "helpful sloth",
              emoji: "🦥",
            },
          },
        ],
      },
      messages: {},
    } as never);

    expect(next.messages?.ackReactionScope).toBe("group-mentions");
    expect(next.messages?.responsePrefix).toBeUndefined();
    expect(next.messages?.groupChat?.mentionPatterns).toBeUndefined();
  });

  it("fills missing agent concurrency defaults", () => {
    const next = applyAgentDefaults({ messages: {} } as never);

    expect(next.agents?.defaults?.maxConcurrent).toBe(DEFAULT_AGENT_MAX_CONCURRENT);
    expect(next.agents?.defaults?.subagents?.maxConcurrent).toBe(DEFAULT_SUBAGENT_MAX_CONCURRENT);
    expect(next.agents?.defaults?.subagents?.archiveAfterMinutes).toBe(
      DEFAULT_SUBAGENT_ARCHIVE_AFTER_MINUTES,
    );
  });

  it("fills missing cron concurrency default", () => {
    const next = applyCronDefaults({ messages: {} } as never);

    expect(next.cron?.maxConcurrentRuns).toBe(DEFAULT_CRON_MAX_CONCURRENT_RUNS);
  });

  it("preserves explicit cron concurrency", () => {
    const next = applyCronDefaults({ cron: { maxConcurrentRuns: 3 } } as never);

    expect(next.cron?.maxConcurrentRuns).toBe(3);
  });

  it("preserves explicit subagent archive default", () => {
    const next = applyAgentDefaults({
      agents: { defaults: { subagents: { archiveAfterMinutes: 0 } } },
    } as never);

    expect(next.agents?.defaults?.subagents?.archiveAfterMinutes).toBe(0);
    expect(next.agents?.defaults?.subagents?.maxConcurrent).toBe(DEFAULT_SUBAGENT_MAX_CONCURRENT);
  });

  it("caps known Mistral model maxTokens at the safe maximum during config loading", () => {
    const next = applyModelDefaults({
      models: {
        providers: {
          mistral: {
            models: [
              {
                id: "mistral-large-latest",
                name: "Mistral Large",
                reasoning: false,
                input: ["text"],
                cost: { input: 1, output: 2, cacheRead: 0.05, cacheWrite: 0 },
                contextWindow: 32_768,
                maxTokens: 17_000,
              },
            ],
          },
        },
      },
    } as never);

    expect(next.models?.providers?.mistral?.models?.[0]?.maxTokens).toBe(16_384);
  });

  it("preserves custom Mistral model maxTokens during config loading", () => {
    const next = applyModelDefaults({
      models: {
        providers: {
          mistral: {
            models: [
              {
                id: "custom-mistral-model",
                name: "Custom Mistral",
                reasoning: false,
                input: ["text"],
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 32_000,
              },
            ],
          },
        },
      },
    } as never);

    expect(next.models?.providers?.mistral?.models?.[0]?.maxTokens).toBe(32_000);
  });

  describe("resolveNormalizedProviderModelMaxTokens", () => {
    it("leaves non-Mistral providers unchanged", () => {
      expect(
        resolveNormalizedProviderModelMaxTokens({
          providerId: "openai",
          modelId: "gpt-4o",
          contextWindow: 128_000,
          rawMaxTokens: 200_000,
        }),
      ).toBe(128_000);
    });

    it("keeps Mistral raw maxTokens below the safe cap", () => {
      expect(
        resolveNormalizedProviderModelMaxTokens({
          providerId: "mistral",
          modelId: "mistral-large-latest",
          contextWindow: 32_768,
          rawMaxTokens: 8_192,
        }),
      ).toBe(8_192);
    });

    it("caps Mistral maxTokens at the per-model safe maximum", () => {
      expect(
        resolveNormalizedProviderModelMaxTokens({
          providerId: "mistral",
          modelId: "mistral-large-latest",
          contextWindow: 32_768,
          rawMaxTokens: 17_000,
        }),
      ).toBe(16_384);
    });

    it("caps Mistral maxTokens by context window when it is smaller than the safe cap", () => {
      expect(
        resolveNormalizedProviderModelMaxTokens({
          providerId: "mistral",
          modelId: "mistral-large-latest",
          contextWindow: 8_192,
          rawMaxTokens: 20_000,
        }),
      ).toBe(8_192);
    });

    it("preserves maxTokens for unknown Mistral models", () => {
      expect(
        resolveNormalizedProviderModelMaxTokens({
          providerId: "mistral",
          modelId: "unknown-model",
          contextWindow: 32_768,
          rawMaxTokens: 20_000,
        }),
      ).toBe(20_000);
    });
  });
});
