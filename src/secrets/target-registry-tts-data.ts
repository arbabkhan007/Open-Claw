import type { SecretTargetRegistryEntry } from "./target-registry-types.js";

const SECRET_INPUT_SHAPE = "secret_input"; // pragma: allowlist secret

/** Core TTS provider SecretRef targets (messages + agents, including personas). */
export const CORE_TTS_SECRET_TARGET_REGISTRY: readonly SecretTargetRegistryEntry[] = [
  {
    id: "messages.tts.providers.*.apiKey",
    targetType: "messages.tts.providers.*.apiKey",
    configFile: "openclaw.json",
    pathPattern: "messages.tts.providers.*.apiKey",
    secretShape: SECRET_INPUT_SHAPE,
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
    providerIdPathSegmentIndex: 3,
  },
  {
    id: "messages.tts.personas.*.providers.*.apiKey",
    targetType: "messages.tts.personas.*.providers.*.apiKey",
    configFile: "openclaw.json",
    pathPattern: "messages.tts.personas.*.providers.*.apiKey",
    secretShape: SECRET_INPUT_SHAPE,
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: false,
    includeInAudit: true,
    providerIdPathSegmentIndex: 5,
  },
  {
    id: "agents.list[].tts.providers.*.apiKey",
    targetType: "agents.list[].tts.providers.*.apiKey",
    configFile: "openclaw.json",
    pathPattern: "agents.list[].tts.providers.*.apiKey",
    secretShape: SECRET_INPUT_SHAPE,
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: false,
    includeInAudit: true,
    providerIdPathSegmentIndex: 5,
  },
  {
    id: "agents.list[].tts.personas.*.providers.*.apiKey",
    targetType: "agents.list[].tts.personas.*.providers.*.apiKey",
    configFile: "openclaw.json",
    pathPattern: "agents.list[].tts.personas.*.providers.*.apiKey",
    secretShape: SECRET_INPUT_SHAPE,
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: false,
    includeInAudit: true,
    providerIdPathSegmentIndex: 7,
  },
];
