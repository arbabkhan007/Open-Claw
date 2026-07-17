// DeepInfra tests cover plugin-owned doctor compatibility migrations.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { legacyConfigRules, normalizeCompatibilityConfig } from "./doctor-contract-api.js";

function deepinfraConfig(provider: Record<string, unknown>): OpenClawConfig {
  return { models: { providers: { deepinfra: provider } } } as unknown as OpenClawConfig;
}

function migratedProvider(cfg: OpenClawConfig): Record<string, unknown> {
  const providers = cfg.models?.providers as Record<string, Record<string, unknown>> | undefined;
  return providers?.deepinfra ?? {};
}

describe("DeepInfra doctor contract", () => {
  it("flags legacy nativeBaseUrl and /v1/inference baseUrl values", () => {
    const nativeRule = legacyConfigRules.find((rule) => rule.path.at(-1) === "nativeBaseUrl");
    const baseUrlRule = legacyConfigRules.find((rule) => rule.path.at(-1) === "baseUrl");
    expect(nativeRule?.message).toContain("openclaw doctor --fix");
    expect(baseUrlRule?.match?.("https://api.deepinfra.com/v1/inference")).toBe(true);
    expect(baseUrlRule?.match?.("https://api.deepinfra.com/v1/openai")).toBe(false);
  });

  it("returns the same config when no deepinfra provider is configured", () => {
    const cfg = { models: { providers: {} } } as OpenClawConfig;
    expect(normalizeCompatibilityConfig({ cfg })).toEqual({ config: cfg, changes: [] });
    expect(normalizeCompatibilityConfig({ cfg: {} as OpenClawConfig }).changes).toEqual([]);
  });

  it("replaces a default-valued nativeBaseUrl with the canonical baseUrl", () => {
    const cfg = deepinfraConfig({
      apiKey: "key",
      nativeBaseUrl: "https://api.deepinfra.com/v1/inference/",
    });
    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.changes).toEqual([
      "models.providers.deepinfra.nativeBaseUrl -> models.providers.deepinfra.baseUrl (https://api.deepinfra.com/v1/openai)",
    ]);
    expect(migratedProvider(result.config)).toEqual({
      apiKey: "key",
      baseUrl: "https://api.deepinfra.com/v1/openai",
    });
  });

  it("retires a custom-host nativeBaseUrl without rewriting its protocol", () => {
    const cfg = deepinfraConfig({ nativeBaseUrl: "https://gw.example.com/v1/inference" });
    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.changes).toEqual([
      "models.providers.deepinfra.nativeBaseUrl: retired custom native endpoint https://gw.example.com/v1/inference; using https://api.deepinfra.com/v1/openai - set models.providers.deepinfra.baseUrl manually if your host serves an OpenAI-compatible videos API",
    ]);
    expect(migratedProvider(result.config)).toEqual({
      baseUrl: "https://api.deepinfra.com/v1/openai",
    });
  });

  it("prefers an existing baseUrl over a custom nativeBaseUrl", () => {
    const cfg = deepinfraConfig({
      baseUrl: "https://gw.example.com/v1/openai",
      nativeBaseUrl: "https://other.example.com/v1/inference",
    });
    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.changes).toEqual([
      "models.providers.deepinfra.nativeBaseUrl: removed (baseUrl is already configured)",
    ]);
    expect(migratedProvider(result.config)).toEqual({
      baseUrl: "https://gw.example.com/v1/openai",
    });
  });

  it("rewrites a /v1/inference baseUrl on the DeepInfra host only", () => {
    const cfg = deepinfraConfig({ baseUrl: "https://api.deepinfra.com/v1/inference" });
    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.changes).toEqual([
      "models.providers.deepinfra.baseUrl: /v1/inference -> /v1/openai (https://api.deepinfra.com/v1/openai)",
    ]);
    expect(migratedProvider(result.config)).toEqual({
      baseUrl: "https://api.deepinfra.com/v1/openai",
    });

    const customCfg = deepinfraConfig({ baseUrl: "https://gw.example.com/v1/inference" });
    expect(normalizeCompatibilityConfig({ cfg: customCfg })).toEqual({
      config: customCfg,
      changes: [],
    });
  });

  it("does not mutate the input config", () => {
    const provider = { nativeBaseUrl: "https://gw.example.com/v1/inference" };
    const cfg = deepinfraConfig(provider);
    normalizeCompatibilityConfig({ cfg });
    expect(provider).toEqual({ nativeBaseUrl: "https://gw.example.com/v1/inference" });
  });
});
