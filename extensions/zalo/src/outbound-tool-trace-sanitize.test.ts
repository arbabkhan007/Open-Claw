// Zalo outbound must strip assistant internal tool-trace scaffolding before
// delivery, matching the sanitizeText hook shipped to sibling channels
// (twitch #103109, mattermost #98693, feishu #98705, etc.).
import { describe, expect, it } from "vitest";
import { zaloPlugin } from "./channel.js";

function sanitizeOutboundText(text: string): string {
  const sanitizeText = zaloPlugin.outbound?.sanitizeText;
  if (!sanitizeText) {
    throw new Error("Expected Zalo outbound sanitizeText hook");
  }
  return sanitizeText({ text, payload: { text } });
}

describe("zalo outbound sanitizeText", () => {
  it("strips internal tool-trace banners before outbound delivery", () => {
    const text = "Done.\n⚠️ 🛠️ `search repos (agent)` failed";
    expect(sanitizeOutboundText(text)).toBe("Done.");
  });

  it("strips XML tool-call scaffolding leaked into assistant text", () => {
    const text = '<tool_call>{"name":"exec"}</tool_call>Message sent.';
    expect(sanitizeOutboundText(text)).toBe("Message sent.");
  });

  it("strips multiline tool-response scaffolding leaked into assistant text", () => {
    const text = [
      "Checking now.",
      "<function_response>",
      'Searching for: "contact"',
      "</function_response>",
      "Message sent.",
    ].join("\n");
    expect(sanitizeOutboundText(text)).toBe("Checking now.\n\nMessage sent.");
  });

  it("preserves ordinary assistant prose while sanitizing", () => {
    const text = "The group has 5 active members.";
    expect(sanitizeOutboundText(text)).toBe(text);
  });
});
