// iMessage outbound must strip assistant internal tool-trace scaffolding,
// matching the sibling channel fixes tracked under #90684 while preserving the
// channel-specific plain-text cleanup that already existed.
import { describe, expect, it } from "vitest";
import { imessagePlugin } from "./channel.js";

describe("imessage outbound sanitizeText", () => {
  it("strips internal tool-trace banners before outbound delivery", () => {
    const text = "Done.\n⚠️ 🛠️ `search repos (agent)` failed";

    expect(imessagePlugin.outbound?.sanitizeText?.({ text, payload: { text } })).toBe("Done.");
  });

  it("preserves ordinary assistant prose while sanitizing", () => {
    const text = "The pipeline has 3 open deals.";

    expect(imessagePlugin.outbound?.sanitizeText?.({ text, payload: { text } })).toBe(text);
  });
});
