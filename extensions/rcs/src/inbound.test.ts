// Rcs tests cover inbound turn body composition, including suggested-reply and
// postback taps mapping to a normal inbound turn.
import { describe, expect, it } from "vitest";
import { describeInboundBody } from "./inbound-format.js";
import type { RcsInboundMessage } from "./types.js";

function msg(overrides: Partial<RcsInboundMessage>): RcsInboundMessage {
  return {
    messageSid: "SM1",
    accountSid: "AC1",
    from: "rcs:+15551234567",
    to: "rcs:myagent_abc_agent",
    body: "",
    mediaUrls: [],
    viaRcs: true,
    ...overrides,
  };
}

describe("describeInboundBody", () => {
  it("uses the display text when present", () => {
    expect(describeInboundBody(msg({ body: "hello" }))).toBe("hello");
  });

  it("surfaces a postback payload as a button turn when there is no display text", () => {
    expect(describeInboundBody(msg({ body: "", buttonPayload: "reorder" }))).toBe(
      "[button] reorder",
    );
  });

  it("prefers the display text when a suggested reply carries both text and payload", () => {
    expect(describeInboundBody(msg({ body: "Yes, do it", buttonPayload: "confirm-1" }))).toBe(
      "Yes, do it",
    );
  });

  it("lists media attachments alongside the body", () => {
    expect(
      describeInboundBody(msg({ body: "look", mediaUrls: ["https://cdn.example/a.png"] })),
    ).toBe("look\n[media] https://cdn.example/a.png");
  });
});
