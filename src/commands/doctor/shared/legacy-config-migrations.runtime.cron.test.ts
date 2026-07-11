// Cron migration tests cover doctor legacy config migration for zero-duration sessionRetention.
import { describe, expect, it } from "vitest";
import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_CRON } from "./legacy-config-migrations.runtime.cron.js";

describe("cron.sessionRetention zero-duration migration", () => {
  const migration = LEGACY_CONFIG_MIGRATIONS_RUNTIME_CRON.find(
    (m) => m.id === "cron.sessionRetention-zero",
  )!;
  const rule = migration.legacyRules?.[0]!;

  // ── Rule match (doctor detection) ───────────────────────────

  it("detects cron.sessionRetention: '0h'", () => {
    expect(rule.match?.({ sessionRetention: "0h" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects cron.sessionRetention: '0d'", () => {
    expect(rule.match?.({ sessionRetention: "0d" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects cron.sessionRetention: '0ms'", () => {
    expect(rule.match?.({ sessionRetention: "0ms" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("does not match positive durations", () => {
    expect(rule.match?.({ sessionRetention: "24h" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "1h30m" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "7d" }, {} as Record<string, unknown>)).toBe(false);
  });

  it("does not match false (documented disable)", () => {
    expect(rule.match?.({ sessionRetention: false }, {} as Record<string, unknown>)).toBe(false);
  });

  it("does not match missing cron config", () => {
    expect(rule.match?.({}, {} as Record<string, unknown>)).toBe(false);
  });

  // ── Migration apply (doctor --fix) ───────────────────────────

  it("removes '0h' and reports change", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "0h" } };
    migration.apply(raw, changes);

    expect(raw.cron).not.toHaveProperty("sessionRetention");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("0h");
  });

  it("removes '0d' and reports change", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "0d" } };
    migration.apply(raw, changes);

    expect(raw.cron).not.toHaveProperty("sessionRetention");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("0d");
  });

  it("removes '0ms' and reports change", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "0ms" } };
    migration.apply(raw, changes);

    expect(raw.cron).not.toHaveProperty("sessionRetention");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("0ms");
  });

  it("preserves positive durations", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "1h30m" } };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({ sessionRetention: "1h30m" });
    expect(changes).toHaveLength(0);
  });

  it("preserves false (documented disable)", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: false } };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({ sessionRetention: false });
    expect(changes).toHaveLength(0);
  });

  it("handles empty cron section", () => {
    const changes: string[] = [];
    const raw = { cron: {} };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({});
    expect(changes).toHaveLength(0);
  });

  it("does nothing when cron is not an object", () => {
    const changes: string[] = [];
    const raw = { cron: "not-an-object" };
    migration.apply(raw, changes);

    expect(raw.cron).toBe("not-an-object");
    expect(changes).toHaveLength(0);
  });

  // ── Rule re-applies after migration ──────────────────────────

  it("rule no longer matches after migration removed the zero value", () => {
    const raw = { cron: { sessionRetention: "0h" } };
    expect(rule.match?.(raw.cron, raw)).toBe(true);
    expect(rule.match?.(raw.cron, {} as Record<string, unknown>)).toBe(true);

    migration.apply(raw, []);

    expect(rule.match?.(raw.cron, raw)).toBe(false);
  });
});
