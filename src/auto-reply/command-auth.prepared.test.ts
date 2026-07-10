import { normalizeStringEntries } from "@openclaw/normalization-core/string-normalization";
/** Tests prepared allow-from compilation: behavior parity and per-config reuse (#50289). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { resolveCommandAuthorization } from "./command-auth.js";
import type { MsgContext } from "./templating.js";

const formatAllowFromSpy = vi.fn(({ allowFrom }: { allowFrom: Array<string | number> }) =>
  normalizeStringEntries(allowFrom).map((entry) => entry.replace(/^discord:/i, "")),
);

const createRegistry = () =>
  createTestRegistry([
    {
      pluginId: "discord",
      plugin: {
        ...createOutboundTestPlugin({ id: "discord", outbound: { deliveryMode: "direct" } }),
        config: {
          listAccountIds: () => [],
          resolveAllowFrom: () => [],
          formatAllowFrom: formatAllowFromSpy,
        },
      },
      source: "test",
    },
    {
      pluginId: "telegram",
      plugin: {
        ...createOutboundTestPlugin({ id: "telegram", outbound: { deliveryMode: "direct" } }),
        config: {
          listAccountIds: () => [],
          resolveAllowFrom: () => [],
          formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
            normalizeStringEntries(allowFrom).map((entry) => entry.replace(/^telegram:/i, "")),
        },
      },
      source: "test",
    },
  ]);

beforeEach(() => {
  formatAllowFromSpy.mockClear();
  setActivePluginRegistry(createRegistry());
});

afterEach(() => {
  setActivePluginRegistry(createRegistry());
});

const discordCtx = (senderId: string): MsgContext =>
  ({
    Provider: "discord",
    Surface: "discord",
    ChatType: "direct",
    From: `discord:${senderId}`,
    SenderId: senderId,
  }) as MsgContext;

const authorize = (cfg: OpenClawConfig, ctx: MsgContext) =>
  resolveCommandAuthorization({ ctx, cfg, commandAuthorized: true });

describe("prepared ownerAllowFrom entry shapes", () => {
  const cfg = {
    channels: { discord: {} },
    commands: { ownerAllowFrom: ["discord:100", 200, " 300 ", "telegram:400"] },
  } as OpenClawConfig;

  const cases = [
    { name: "matching channel-prefixed entry", senderId: "100", owner: true },
    { name: "numeric entry", senderId: "200", owner: true },
    { name: "whitespace-padded entry", senderId: "300", owner: true },
    { name: "other-channel-prefixed entry", senderId: "400", owner: false },
    { name: "unlisted sender", senderId: "500", owner: false },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} -> senderIsOwner=${testCase.owner}`, () => {
      expect(authorize(cfg, discordCtx(testCase.senderId)).senderIsOwner).toBe(testCase.owner);
    });
  }
});

describe("prepared list reuse", () => {
  it("does not re-format the configured owner list on subsequent messages", () => {
    const bulk = Array.from({ length: 5000 }, (_, i) => `bulk${i}`);
    const cfg = {
      channels: { discord: {} },
      commands: { ownerAllowFrom: ["discord:100", "200", "300", ...bulk] },
    } as OpenClawConfig;

    expect(authorize(cfg, discordCtx("100")).senderIsOwner).toBe(true);
    // Single-value sender-candidate normalization still runs per message; only
    // multi-entry list formatting must be compiled once per config array.
    const listFormatCalls = () =>
      formatAllowFromSpy.mock.calls.filter(([params]) => params.allowFrom.length > 1).length;
    const afterFirstMessage = listFormatCalls();
    expect(afterFirstMessage).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      expect(authorize(cfg, discordCtx("200")).senderIsOwner).toBe(true);
      expect(authorize(cfg, discordCtx("999")).senderIsOwner).toBe(false);
    }
    expect(listFormatCalls()).toBe(afterFirstMessage);
  });

  it("keeps distinct configs isolated", () => {
    const cfgA = {
      channels: { discord: {} },
      commands: { ownerAllowFrom: ["111"] },
    } as OpenClawConfig;
    const cfgB = {
      channels: { discord: {} },
      commands: { ownerAllowFrom: ["222"] },
    } as OpenClawConfig;

    expect(authorize(cfgA, discordCtx("111")).senderIsOwner).toBe(true);
    expect(authorize(cfgB, discordCtx("111")).senderIsOwner).toBe(false);
    expect(authorize(cfgB, discordCtx("222")).senderIsOwner).toBe(true);
    expect(authorize(cfgA, discordCtx("222")).senderIsOwner).toBe(false);
  });
});

describe("per-message OwnerAllowFrom overrides", () => {
  it("honors a context override when no config owners exist", () => {
    const cfg = { channels: { discord: {} } } as OpenClawConfig;
    const ctx = { ...discordCtx("999"), OwnerAllowFrom: ["999"] } as MsgContext;

    expect(authorize(cfg, ctx).senderIsOwner).toBe(true);
    expect(authorize(cfg, discordCtx("999")).senderIsOwner).toBe(false);
  });

  it("keeps configured owners authoritative over context overrides", () => {
    const cfg = {
      channels: { discord: {} },
      commands: { ownerAllowFrom: ["456"] },
    } as OpenClawConfig;
    const ctx = { ...discordCtx("999"), OwnerAllowFrom: ["999"] } as MsgContext;

    expect(authorize(cfg, ctx).senderIsOwner).toBe(false);
    expect(
      authorize(cfg, { ...discordCtx("456"), OwnerAllowFrom: ["999"] } as MsgContext).senderIsOwner,
    ).toBe(true);
  });
});

describe("multi-provider scope isolation", () => {
  it("filters one shared ownerAllowFrom array independently per provider", () => {
    const cfg = {
      channels: { discord: {}, telegram: {} },
      commands: { ownerAllowFrom: ["discord:100", "telegram:200"] },
    } as OpenClawConfig;
    const telegramCtx = (senderId: string): MsgContext =>
      ({
        Provider: "telegram",
        Surface: "telegram",
        ChatType: "direct",
        From: `telegram:${senderId}`,
        SenderId: senderId,
      }) as MsgContext;

    // Interleave so each provider's prepared list is created and then re-read
    // from the same cached raw array without bleeding into the other scope.
    expect(authorize(cfg, discordCtx("100")).senderIsOwner).toBe(true);
    expect(authorize(cfg, telegramCtx("100")).senderIsOwner).toBe(false);
    expect(authorize(cfg, telegramCtx("200")).senderIsOwner).toBe(true);
    expect(authorize(cfg, discordCtx("200")).senderIsOwner).toBe(false);
    expect(authorize(cfg, discordCtx("100")).senderIsOwner).toBe(true);
  });
});

describe("prepared commands.allowFrom", () => {
  it("authorizes senders via the commands allowlist without re-formatting per message", () => {
    const cfg = {
      channels: { discord: {} },
      commands: { allowFrom: { discord: ["discord:100", "200"] } },
    } as unknown as OpenClawConfig;

    expect(authorize(cfg, discordCtx("100")).isAuthorizedSender).toBe(true);
    expect(authorize(cfg, discordCtx("999")).isAuthorizedSender).toBe(false);
    const listFormatCalls = () =>
      formatAllowFromSpy.mock.calls.filter(([params]) => params.allowFrom.length > 1).length;
    const afterFirstMessages = listFormatCalls();
    expect(authorize(cfg, discordCtx("200")).isAuthorizedSender).toBe(true);
    expect(listFormatCalls()).toBe(afterFirstMessages);
  });

  it('resolves the global "*" commands allowlist when no provider list exists', () => {
    const cfg = {
      channels: { discord: {} },
      commands: { allowFrom: { "*": ["discord:100", "200"] } },
    } as unknown as OpenClawConfig;

    expect(authorize(cfg, discordCtx("100")).isAuthorizedSender).toBe(true);
    expect(authorize(cfg, discordCtx("200")).isAuthorizedSender).toBe(true);
    expect(authorize(cfg, discordCtx("999")).isAuthorizedSender).toBe(false);
  });
});
