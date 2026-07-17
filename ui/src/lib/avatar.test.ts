import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAvatarInitial } from "./avatar.ts";

describe("deriveAvatarInitial", () => {
  it("returns the uppercased first code point for ASCII names", () => {
    expect(deriveAvatarInitial("Alice")).toBe("A");
    expect(deriveAvatarInitial("bob")).toBe("B");
  });

  it("keeps an emoji initial intact instead of a dangling surrogate half", () => {
    expect(deriveAvatarInitial("😀Name")).toBe("😀");
    expect(deriveAvatarInitial("🚀")).toBe("🚀");
  });

  it("preserves complete grapheme clusters for joined emoji and flags", () => {
    expect(deriveAvatarInitial("👨‍👩‍👧‍👦Family")).toBe("👨‍👩‍👧‍👦");
    expect(deriveAvatarInitial("🇺🇸Flag")).toBe("🇺🇸");
    expect(deriveAvatarInitial("👍🏻Thumbs")).toBe("👍🏻");
  });

  it("returns an empty string for empty or missing input", () => {
    expect(deriveAvatarInitial("")).toBe("");
    expect(deriveAvatarInitial(null)).toBe("");
    expect(deriveAvatarInitial(undefined)).toBe("");
  });
});

describe("deriveAvatarInitial without Intl.Segmenter", () => {
  const originalIntlSegmenter = Intl.Segmenter;

  beforeEach(() => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
  });

  afterEach(() => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: originalIntlSegmenter });
    vi.unstubAllGlobals();
  });

  it("returns the uppercased first ASCII character", () => {
    expect(deriveAvatarInitial("Alice")).toBe("A");
    expect(deriveAvatarInitial("bob")).toBe("B");
  });

  it("keeps a surrogate pair intact for astral emoji", () => {
    expect(deriveAvatarInitial("😀Name")).toBe("😀");
    expect(deriveAvatarInitial("🚀")).toBe("🚀");
  });

  it("falls back to the first code point for complex grapheme clusters", () => {
    expect(deriveAvatarInitial("👨‍👩‍👧‍👦Family")).toBe("👨");
    expect(deriveAvatarInitial("🇺🇸Flag")).toBe("🇺");
    expect(deriveAvatarInitial("👍🏻Thumbs")).toBe("👍");
  });

  it("returns an empty string for empty or missing input", () => {
    expect(deriveAvatarInitial("")).toBe("");
    expect(deriveAvatarInitial(null)).toBe("");
    expect(deriveAvatarInitial(undefined)).toBe("");
  });
});
