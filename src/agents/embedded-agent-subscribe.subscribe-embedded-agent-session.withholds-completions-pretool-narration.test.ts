// Chat Completions tags pre-tool narration commentary only at the tool-call
// boundary, so during the unphased deltas the subscriber must not durably
// commit the text on block-reply (text_end) channels — otherwise the mid-drain
// or the pre-tool flushBlockReplyBuffer posts the narration as an answer. A
// turn whose spurious tool calls get stripped (tags rolled back) and a plain
// non-tool answer must still be delivered in full.
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { describe, expect, it, vi } from "vitest";
import { createStubSessionHarness } from "./embedded-agent-subscribe.e2e-harness.js";
import { subscribeEmbeddedAgentSession } from "./embedded-agent-subscribe.js";

function completionsAssistant(text: string, extra?: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    content: [{ type: "text", text }, ...(extra ?? [])],
  } as unknown as AssistantMessage;
}

function postedBlockReplyText(onBlockReply: ReturnType<typeof vi.fn>): string {
  return onBlockReply.mock.calls.map((call) => call[0]?.text ?? "").join(" ");
}

describe("subscribeEmbeddedAgentSession — Chat Completions pre-tool narration", () => {
  it("withholds pre-tool narration from durable block replies on a text_end channel", () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    subscribeEmbeddedAgentSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedAgentSession>[0]["session"],
      runId: "run-completions-withhold",
      onBlockReply,
      blockReplyBreak: "text_end",
      // Tiny chunking would mid-drain the narration during deltas without the gate.
      blockReplyChunking: { minChars: 4, maxChars: 200 },
    });

    const narration = "Importing ORDER-1234 into the tracker… ";
    emit({ type: "message_start", message: completionsAssistant("") });
    emit({
      type: "message_update",
      message: completionsAssistant(narration),
      assistantMessageEvent: { type: "text_delta", delta: narration },
    });
    // Tool execution flushes the block-reply buffer before running — the leak point.
    emit({
      type: "tool_execution_start",
      toolName: "import_order",
      toolCallId: "tool-1",
      args: { id: "ORDER-1234" },
    });
    // The turn resolves as a tool turn: the leading text is commentary.
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        api: "openai-completions",
        stopReason: "toolUse",
        content: [
          {
            type: "text",
            text: narration,
            textSignature: JSON.stringify({ v: 1, id: "commentary-0", phase: "commentary" }),
          },
          { type: "toolCall", id: "tool-1", name: "import_order", arguments: {} },
        ],
      } as unknown as AssistantMessage,
    });

    expect(postedBlockReplyText(onBlockReply)).not.toContain("Importing ORDER-1234");
  });

  it("still delivers the text when spurious tool calls were stripped and tags rolled back", async () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    subscribeEmbeddedAgentSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedAgentSession>[0]["session"],
      runId: "run-completions-stripped-spurious",
      onBlockReply,
      blockReplyBreak: "text_end",
    });

    const answer = "Here is the answer.";
    emit({ type: "message_start", message: completionsAssistant("") });
    emit({
      type: "message_update",
      message: completionsAssistant(answer),
      assistantMessageEvent: { type: "text_delta", delta: answer },
    });
    // The transport stripped the spurious tool calls and rolled the provisional
    // commentary tags back, so message_end carries plain unphased text.
    emit({ type: "message_end", message: completionsAssistant(answer) });

    await vi.waitFor(() => {
      expect(onBlockReply).toHaveBeenCalled();
    });
    expect(postedBlockReplyText(onBlockReply)).toContain("Here is the answer.");
  });

  it("flushes withheld unphased text at text_end so ordinary answers stay deliverable", async () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    subscribeEmbeddedAgentSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedAgentSession>[0]["session"],
      runId: "run-completions-text-end-fallback",
      onBlockReply,
      blockReplyBreak: "text_end",
      blockReplyChunking: { minChars: 4, maxChars: 200 },
    });

    const answer = "An ordinary answer with no tool calls.";
    emit({ type: "message_start", message: completionsAssistant("") });
    emit({
      type: "message_update",
      message: completionsAssistant(answer),
      assistantMessageEvent: { type: "text_delta", delta: answer },
    });
    // Completions text stays permanently unphased on ordinary turns; the
    // text_end fallback must deliver what the withholding gate buffered.
    emit({
      type: "message_update",
      message: completionsAssistant(answer),
      assistantMessageEvent: { type: "text_end", contentIndex: 0 },
    });

    await vi.waitFor(() => {
      expect(onBlockReply).toHaveBeenCalled();
    });
    expect(postedBlockReplyText(onBlockReply)).toContain("An ordinary answer");
  });

  it("keeps prefix-before-suffix order when text_end carries the reply tail", async () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    subscribeEmbeddedAgentSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedAgentSession>[0]["session"],
      runId: "run-completions-text-end-suffix-order",
      onBlockReply,
      blockReplyBreak: "text_end",
      blockReplyChunking: { minChars: 4, maxChars: 200 },
    });

    emit({ type: "message_start", message: completionsAssistant("") });
    emit({
      type: "message_update",
      message: completionsAssistant("prefix "),
      assistantMessageEvent: { type: "text_delta", delta: "prefix " },
    });
    // A text_end can deliver the final suffix; the withheld prefix must land first.
    emit({
      type: "message_update",
      message: completionsAssistant("prefix suffix"),
      assistantMessageEvent: { type: "text_end", contentIndex: 0, delta: "suffix" },
    });

    await vi.waitFor(() => {
      expect(onBlockReply).toHaveBeenCalled();
    });
    expect(postedBlockReplyText(onBlockReply)).toContain("prefix suffix");
  });

  it("still delivers a non-tool Chat Completions answer in full on a text_end channel", async () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    subscribeEmbeddedAgentSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedAgentSession>[0]["session"],
      runId: "run-completions-answer",
      onBlockReply,
      blockReplyBreak: "text_end",
    });

    const answer = "Here is the full answer.";
    emit({ type: "message_start", message: completionsAssistant("") });
    emit({
      type: "message_update",
      message: completionsAssistant(answer),
      assistantMessageEvent: { type: "text_delta", delta: answer },
    });
    emit({
      type: "message_update",
      message: completionsAssistant(answer),
      assistantMessageEvent: { type: "text_end", contentIndex: 0 },
    });
    emit({ type: "message_end", message: completionsAssistant(answer) });

    await vi.waitFor(() => {
      expect(onBlockReply).toHaveBeenCalled();
    });
    expect(postedBlockReplyText(onBlockReply)).toContain("Here is the full answer.");
  });
});
