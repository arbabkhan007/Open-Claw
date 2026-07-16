/**
 * Route classification for transcript redaction: which provider API family an
 * assistant message came from decides which signature fields survive redaction.
 */
import type { ProviderEndpointClass } from "./provider-attribution.js";

export type TranscriptAssistantRoute = {
  api?: string;
  endpointClass?: ProviderEndpointClass;
  model?: string;
  provider?: string;
};

const OPENAI_RESPONSES_APIS = new Set([
  "openai-responses",
  "azure-openai-responses",
  "openai-chatgpt-responses",
  "openclaw-openai-responses-transport",
  "openclaw-azure-openai-responses-transport",
]);
const GOOGLE_REASONING_APIS = new Set([
  "google-generative-ai",
  "google-vertex",
  "google-gemini-cli",
  "openclaw-google-generative-ai-transport",
]);
const ANTHROPIC_REASONING_APIS = new Set([
  "anthropic-messages",
  "bedrock-converse-stream",
  "openclaw-anthropic-messages-transport",
]);
const OPENAI_COMPLETIONS_APIS = new Set([
  "openai-completions",
  "openclaw-openai-completions-transport",
]);

export function isOpenAIResponsesRoute(route: TranscriptAssistantRoute | undefined): boolean {
  return typeof route?.api === "string" && OPENAI_RESPONSES_APIS.has(route.api);
}

export function isGoogleReasoningRoute(route: TranscriptAssistantRoute | undefined): boolean {
  return typeof route?.api === "string" && GOOGLE_REASONING_APIS.has(route.api);
}

export function isAnthropicReasoningRoute(route: TranscriptAssistantRoute | undefined): boolean {
  return typeof route?.api === "string" && ANTHROPIC_REASONING_APIS.has(route.api);
}

export function isOpenAICompletionsRoute(route: TranscriptAssistantRoute | undefined): boolean {
  return typeof route?.api === "string" && OPENAI_COMPLETIONS_APIS.has(route.api);
}

export function isGoogleOpenAICompletionsRoute(
  route: TranscriptAssistantRoute | undefined,
): boolean {
  return (
    isOpenAICompletionsRoute(route) &&
    (route?.provider === "google" ||
      route?.endpointClass === "google-generative-ai" ||
      route?.endpointClass === "google-vertex")
  );
}

export function isCustomProviderRoute(route: TranscriptAssistantRoute | undefined): boolean {
  return (
    Boolean(route?.api && route.model && route.provider) &&
    route?.api !== "mistral-conversations" &&
    !isOpenAIResponsesRoute(route) &&
    !isGoogleReasoningRoute(route) &&
    !isAnthropicReasoningRoute(route) &&
    !isOpenAICompletionsRoute(route)
  );
}

export function isGitHubCopilotResponsesRoute(
  route: TranscriptAssistantRoute | undefined,
): boolean {
  return (
    (route?.api === "openai-responses" || route?.api === "openclaw-openai-responses-transport") &&
    route.provider === "github-copilot"
  );
}
