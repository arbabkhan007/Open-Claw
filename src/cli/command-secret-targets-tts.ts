/** Shared TTS provider SecretRef target ids for command secret policy. */
export const STATIC_TTS_PROVIDER_TARGET_IDS = [
  "agents.list[].tts.providers.*.apiKey",
  "agents.list[].tts.personas.*.providers.*.apiKey",
  "messages.tts.providers.*.apiKey",
  "messages.tts.personas.*.providers.*.apiKey",
] as const;
