// Cron migration tests cover doctor legacy config migration for zero-duration sessionRetention.
import { describe, expect, it } from "vitest";
import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_CRON } from "./legacy-config-migrations.runtime.cron.js";

describe("cron.sessionRetention zero-duration migration", () => {
  const migration = LEGACY_CONFIG_MIGRATIONS_RUNTIME_CRON.find(
    (m) => m.id === "cron.sessionRetention-zero",
  );
  if (!migration) {
    throw new Error("cron.sessionRetention-zero migration not found");
  }
  const rule = migration.legacyRules?.[0];
  if (!rule) {
    throw new Error("cron.sessionRetention-zero rule not found");
  }

  // ── Rule match (doctor detection): parser-backed ────────────

  it("detects literal zero strings", () => {
    expect(rule.match?.({ sessionRetention: "0h" }, {} as Record<string, unknown>)).toBe(true);
    expect(rule.match?.({ sessionRetention: "0d" }, {} as Record<string, unknown>)).toBe(true);
    expect(rule.match?.({ sessionRetention: "0ms" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects bare-number zero", () => {
    expect(rule.match?.({ sessionRetention: "0" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects zero in other units", () => {
    expect(rule.match?.({ sessionRetention: "0s" }, {} as Record<string, unknown>)).toBe(true);
    expect(rule.match?.({ sessionRetention: "0m" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects decimal zero", () => {
    expect(rule.match?.({ sessionRetention: "0.0h" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("detects composite zero", () => {
    expect(rule.match?.({ sessionRetention: "0h0m" }, {} as Record<string, unknown>)).toBe(true);
    expect(rule.match?.({ sessionRetention: "0h0m0s" }, {} as Record<string, unknown>)).toBe(true);
  });

  it("does not match positive durations", () => {
    expect(rule.match?.({ sessionRetention: "24h" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "1h30m" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "7d" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "500ms" }, {} as Record<string, unknown>)).toBe(false);
  });

  it("does not match false (documented disable)", () => {
    expect(rule.match?.({ sessionRetention: false }, {} as Record<string, unknown>)).toBe(false);
  });

  it("does not match missing cron config", () => {
    expect(rule.match?.({}, {} as Record<string, unknown>)).toBe(false);
  });

  it("does not match unparseable values (leave for schema diagnostic)", () => {
    expect(rule.match?.({ sessionRetention: "abc" }, {} as Record<string, unknown>)).toBe(false);
    expect(rule.match?.({ sessionRetention: "" }, {} as Record<string, unknown>)).toBe(false);
  });

  // ── Migration apply (doctor --fix): parser-backed ───────────

  it("removes zero-duration strings and reports change", () => {
    for (const val of ["0h", "0d", "0ms", "0", "0s", "0m", "0.0h", "0h0m"]) {
      const changes: string[] = [];
      const raw = { cron: { sessionRetention: val } };
      migration.apply(raw, changes);

      expect(raw.cron).not.toHaveProperty("sessionRetention");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toContain(val);
    }
  });

  it("preserves positive durations", () => {
    for (const val of ["1h30m", "24h", "7d", "500ms"]) {
      const changes: string[] = [];
      const raw = { cron: { sessionRetention: val } };
      migration.apply(raw, changes);

      expect(raw.cron).toEqual({ sessionRetention: val });
      expect(changes).toHaveLength(0);
    }
  });

  it("preserves false (documented disable)", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: false } };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({ sessionRetention: false });
    expect(changes).toHaveLength(0);
  });

  it("preserves unparseable values (leave for schema diagnostic)", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "abc" } };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({ sessionRetention: "abc" });
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

  // ── Migration preserves unrelated cron config ────────────────

  it("preserves valid cron.runLog when removing zero sessionRetention", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "0h", runLog: { maxBytes: 4096, keepLines: 500 } } };
    migration.apply(raw, changes);

    expect(raw.cron).not.toHaveProperty("sessionRetention");
    expect(raw.cron).toHaveProperty("runLog");
    expect(raw.cron?.runLog).toEqual({ maxBytes: 4096, keepLines: 500 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("0h");
  });

  it("preserves valid cron.runLog when sessionRetention is positive (no-op)", () => {
    const changes: string[] = [];
    const raw = { cron: { sessionRetention: "7d", runLog: { maxBytes: 4096 } } };
    migration.apply(raw, changes);

    expect(raw.cron).toEqual({ sessionRetention: "7d", runLog: { maxBytes: 4096 } });
    expect(changes).toHaveLength(0);
  });

  // ── Rule re-applies after migration ──────────────────────────

  it("rule no longer matches after migration removed the zero value", () => {
    const raw = { cron: { sessionRetention: "0h" } };
    expect(rule.match?.(raw.cron, raw)).toBe(true);

    migration.apply(raw, []);

    expect(rule.match?.(raw.cron, raw)).toBe(false);
  });
});
