import { sanitizeForLog } from "../../../../packages/terminal-core/src/ansi.js";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { asObjectRecord } from "./object.js";

type LegacyMemorySlotHit = {
  location: { scope: "root" } | { scope: "agent"; index: number };
  pathLabel: string;
  legacyValue: string;
  recallValue?: string;
  conflict: boolean;
};

function ownSlot(slots: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(slots, key);
}

function normalizeSlotText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function collectSlotHit(params: {
  location: LegacyMemorySlotHit["location"];
  slots: Record<string, unknown>;
  pathLabel: string;
}): LegacyMemorySlotHit | undefined {
  if (!ownSlot(params.slots, "memory")) {
    return undefined;
  }
  const legacyValue = normalizeSlotText(params.slots.memory);
  if (!legacyValue) {
    return {
      location: params.location,
      pathLabel: `${params.pathLabel}.memory`,
      legacyValue: "",
      conflict: false,
    };
  }
  const recallValue = ownSlot(params.slots, "memory.recall")
    ? normalizeSlotText(params.slots["memory.recall"])
    : undefined;
  return {
    location: params.location,
    pathLabel: `${params.pathLabel}.memory`,
    legacyValue,
    recallValue,
    conflict: recallValue !== undefined && recallValue !== legacyValue,
  };
}

export function scanLegacyMemorySlotConfig(cfg: OpenClawConfig): LegacyMemorySlotHit[] {
  const hits: LegacyMemorySlotHit[] = [];
  const globalSlots = asObjectRecord(cfg.plugins?.slots);
  if (globalSlots) {
    const hit = collectSlotHit({
      location: { scope: "root" },
      slots: globalSlots,
      pathLabel: "plugins.slots",
    });
    if (hit) {
      hits.push(hit);
    }
  }

  const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  for (const [index, agent] of agents.entries()) {
    const agentRecord = asObjectRecord(agent);
    const plugins = asObjectRecord(agentRecord?.plugins);
    const slots = asObjectRecord(plugins?.slots);
    if (!slots) {
      continue;
    }
    const hit = collectSlotHit({
      location: { scope: "agent", index },
      slots,
      pathLabel: `agents.list.${index}.plugins.slots`,
    });
    if (hit) {
      hits.push(hit);
    }
  }

  return hits;
}

export function collectLegacyMemorySlotWarnings(params: {
  hits: readonly LegacyMemorySlotHit[];
  doctorFixCommand: string;
}): string[] {
  if (params.hits.length === 0) {
    return [];
  }
  const conflicts = params.hits.filter((hit) => hit.conflict);
  const fixableCount = params.hits.length - conflicts.length;
  const sample = sanitizeForLog(params.hits[0]?.pathLabel ?? "plugins.slots.memory");
  const warnings = [
    `- Found ${params.hits.length} legacy memory slot selector${params.hits.length === 1 ? "" : "s"} (for example ${sample}).`,
    '- `plugins.slots.memory` is deprecated; use `plugins.slots["memory.recall"]` for factual recall provider selection.',
    "- Doctor removes non-conflicting legacy memory selectors after migrating them to memory.recall.",
  ];
  if (fixableCount > 0) {
    warnings.push(
      `- Run "${params.doctorFixCommand}" to migrate ${fixableCount} non-conflicting legacy memory slot${fixableCount === 1 ? "" : "s"}.`,
    );
  }
  if (conflicts.length > 0) {
    warnings.push(
      `- ${conflicts.length} legacy memory slot${conflicts.length === 1 ? " also defines" : "s also define"} a different memory.recall value; resolve ${conflicts.length === 1 ? "it" : "those"} manually so doctor does not guess.`,
    );
  }
  return warnings;
}

function migrateSlots(params: {
  slots: Record<string, unknown>;
  hit: LegacyMemorySlotHit;
}): "migrated" | "removed-redundant" | "removed-empty" | "skipped-conflict" | "unchanged" {
  if (!ownSlot(params.slots, "memory")) {
    return "unchanged";
  }
  if (params.hit.conflict) {
    return "skipped-conflict";
  }
  if (params.hit.legacyValue) {
    if (params.hit.recallValue === params.hit.legacyValue) {
      delete params.slots.memory;
      return "removed-redundant";
    }
    params.slots["memory.recall"] = params.hit.legacyValue;
    delete params.slots.memory;
    return "migrated";
  }
  delete params.slots.memory;
  return "removed-empty";
}

export function maybeRepairLegacyMemorySlotConfig(cfg: OpenClawConfig): {
  config: OpenClawConfig;
  changes: string[];
  warnings?: string[];
} {
  const hits = scanLegacyMemorySlotConfig(cfg);
  if (hits.length === 0) {
    return { config: cfg, changes: [] };
  }

  const next = structuredClone(cfg);
  const changes: string[] = [];
  const warnings: string[] = [];

  const applyHit = (
    hit: LegacyMemorySlotHit,
    slots: Record<string, unknown> | null | undefined,
  ) => {
    if (!slots) {
      return;
    }
    const result = migrateSlots({ slots, hit });
    if (result === "migrated") {
      changes.push(
        `- ${hit.pathLabel}: moved legacy memory slot to memory.recall (${hit.legacyValue}) and removed the legacy selector.`,
      );
    } else if (result === "removed-redundant") {
      changes.push(
        `- ${hit.pathLabel}: removed redundant legacy memory slot selector already covered by memory.recall (${hit.legacyValue}).`,
      );
    } else if (result === "removed-empty") {
      changes.push(`- ${hit.pathLabel}: removed empty legacy memory slot selector.`);
    } else if (result === "skipped-conflict") {
      warnings.push(
        `- ${hit.pathLabel}: kept legacy memory slot because memory.recall is already "${hit.recallValue}" while memory is "${hit.legacyValue}".`,
      );
    }
  };

  for (const hit of hits) {
    if (hit.location.scope === "root") {
      applyHit(hit, asObjectRecord(next.plugins?.slots));
      continue;
    }
    const agent = next.agents?.list?.[hit.location.index];
    const agentRecord = asObjectRecord(agent);
    const plugins = asObjectRecord(agentRecord?.plugins);
    applyHit(hit, asObjectRecord(plugins?.slots));
  }

  return {
    config: changes.length > 0 ? next : cfg,
    changes: changes.map((change) => sanitizeForLog(change)),
    ...(warnings.length > 0
      ? { warnings: warnings.map((warning) => sanitizeForLog(warning)) }
      : {}),
  };
}
