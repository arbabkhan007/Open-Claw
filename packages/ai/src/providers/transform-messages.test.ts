// Covers tool-call-id normalization invariants for cross-provider replay (#95623).
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message, Model, ToolResultMessage } from "../types.js";
import { transformMessages } from "./transform-messages.js";

const anthropicModel: Model<"anthropic-messages"> = {
  id: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1, output: 2, cacheRead: 0.25, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8_192,
};

// Mirrors anthropic.ts / google-shared.ts normalizeToolCallId (charset scrub).
const anthropicNormalize = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

// OpenAI-responses composite id — the `|` 400s the Anthropic API.
const compositeId = "call_AbCd0123|fc_beef01";
const scrubbedId = "call_AbCd0123_fc_beef01";

function toolIds(out: Message[]): string[] {
  const ids: string[] = [];
  for (const m of out) {
    if (m.role === "toolResult") {
      ids.push(`result:${m.toolCallId}`);
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "toolCall") {
          ids.push(`call:${block.id}`);
        }
      }
    }
  }
  return ids;
}

function orphanToolResult(): Message {
  return {
    role: "toolResult",
    toolCallId: compositeId,
    toolName: "x",
    content: [{ type: "text", text: "ok" }],
  } as unknown as ToolResultMessage;
}

function sameModelCallAndResult(): Message[] {
  return [
    {
      role: "assistant",
      provider: "anthropic",
      api: "anthropic-messages",
      model: "claude-sonnet-5",
      content: [{ type: "toolCall", id: compositeId, name: "x", arguments: {} }],
    },
    {
      role: "toolResult",
      toolCallId: compositeId,
      toolName: "x",
      content: [{ type: "text", text: "ok" }],
    },
  ] as unknown as Message[];
}

describe("transformMessages tool-call-id normalization (#95623)", () => {
  it("S1: target-safe mode scrubs an orphaned non-conforming toolResult id", () => {
    const out = transformMessages([orphanToolResult()], anthropicModel, anthropicNormalize, true);
    const result = out.find((m) => m.role === "toolResult") as ToolResultMessage;
    expect(result.toolCallId).toBe(scrubbedId);
  });

  it("S3: target-safe mode scrubs a same-model-tagged toolCall and keeps its result paired", () => {
    const out = transformMessages(
      sameModelCallAndResult(),
      anthropicModel,
      anthropicNormalize,
      true,
    );
    expect(toolIds(out)).toEqual([`call:${scrubbedId}`, `result:${scrubbedId}`]);
  });

  it("regression: default mode leaves a same-model composite id untouched", () => {
    const out = transformMessages(sameModelCallAndResult(), anthropicModel, anthropicNormalize);
    expect(toolIds(out)).toEqual([`call:${compositeId}`, `result:${compositeId}`]);
  });

  it("regression: cross-provider pair still normalizes both ids via the map", () => {
    const msgs = [
      {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5",
        content: [{ type: "toolCall", id: compositeId, name: "x", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: compositeId,
        toolName: "x",
        content: [{ type: "text", text: "ok" }],
      },
    ] as unknown as Message[];
    const out = transformMessages(msgs, anthropicModel, anthropicNormalize);
    expect(toolIds(out)).toEqual([`call:${scrubbedId}`, `result:${scrubbedId}`]);
  });

  it("regression: default mode never invokes a source-requiring normalizer on a map-miss result", () => {
    const normalizer = vi.fn(
      (id: string, _model: Model<"anthropic-messages">, source?: AssistantMessage) => {
        // openai-responses reads source.provider; a source-less call would break it.
        void source?.provider;
        return id.replace(/[^a-zA-Z0-9_-]/g, "_");
      },
    );
    const out = transformMessages([orphanToolResult()], anthropicModel, normalizer);
    const result = out.find((m) => m.role === "toolResult") as ToolResultMessage;
    expect(result.toolCallId).toBe(compositeId);
    expect(normalizer).not.toHaveBeenCalled();
  });

  it("SDK compat: default mode still accepts the existing required-`source` plugin normalizer (#95623)", () => {
    // `plugin-sdk/llm` re-exports transformMessages; existing provider plugins pass a
    // normalizer whose `source` is required. Widening it back to optional makes this
    // explicitly-typed callback un-assignable under strict function checks, so this call
    // is a compile-time guard for the public SDK callback contract (the default overload).
    const requiredSourceNormalizer: (
      id: string,
      model: Model<"anthropic-messages">,
      source: AssistantMessage,
    ) => string = (id, _model, source) =>
      source.provider === anthropicModel.provider ? id : id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const out = transformMessages(
      [
        {
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-5",
          content: [{ type: "toolCall", id: compositeId, name: "x", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: compositeId,
          toolName: "x",
          content: [{ type: "text", text: "ok" }],
        },
      ] as unknown as Message[],
      anthropicModel,
      requiredSourceNormalizer,
    );
    expect(toolIds(out)).toEqual([`call:${scrubbedId}`, `result:${scrubbedId}`]);
  });
});
