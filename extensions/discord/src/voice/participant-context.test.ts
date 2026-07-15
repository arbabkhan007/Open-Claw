// Discord voice participant display names flow from external member labels
// (member nick / global_name / username) into the agent's voice-roster prompt.
// Truncation must stay UTF-16 safe so an emoji straddling the label limit does
// not leave a lone surrogate that corrupts the JSON-quoted roster line.
import { describe, expect, it } from "vitest";
import type { APIVoiceState } from "../internal/discord.js";
import { formatDiscordVoiceParticipantStateLine } from "./participant-context.js";

// Matches a high UTF-16 surrogate with no paired low surrogate following it.
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u;

function participantWithNick(nick: string): { userId: string; state: APIVoiceState } {
  return {
    userId: "u1",
    state: {
      user_id: "u1",
      member: { nick },
    } as unknown as APIVoiceState,
  };
}

// The roster line is `- user_id=<json> display_name=<json>`; pull the label back
// out of its JSON-quoted form so the actual decoded characters can be inspected.
function extractDisplayName(line: string): string {
  const json = line.split(" display_name=")[1] ?? "";
  return JSON.parse(json) as string;
}

describe("formatDiscordVoiceParticipantStateLine", () => {
  it("drops a split emoji at the label boundary instead of leaving a lone surrogate", () => {
    // 99 ASCII chars + 😀 (U+1F600, two UTF-16 code units) = 101 code units.
    // A raw .slice(0, 100) keeps the lone high surrogate; truncateUtf16Safe backs up.
    const nick = `${"a".repeat(99)}\u{1F600}`;
    const label = extractDisplayName(
      formatDiscordVoiceParticipantStateLine(participantWithNick(nick)),
    );
    expect(LONE_HIGH_SURROGATE.test(label)).toBe(false);
    expect(label).toBe("a".repeat(99));
  });

  it("keeps an emoji that fits within the label limit intact", () => {
    // 98 ASCII chars + 😀 = 100 code units, so the emoji fits without truncation.
    const nick = `${"a".repeat(98)}\u{1F600}`;
    const label = extractDisplayName(
      formatDiscordVoiceParticipantStateLine(participantWithNick(nick)),
    );
    expect(LONE_HIGH_SURROGATE.test(label)).toBe(false);
    expect(label).toBe(`${"a".repeat(98)}\u{1F600}`);
  });

  it("leaves a short ASCII label unchanged", () => {
    const label = extractDisplayName(
      formatDiscordVoiceParticipantStateLine(participantWithNick("Ada")),
    );
    expect(label).toBe("Ada");
    expect(LONE_HIGH_SURROGATE.test(label)).toBe(false);
  });
});
