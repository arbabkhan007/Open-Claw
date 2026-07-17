import { describe, expect, it } from "vitest";
import { formatUnknownError } from "./format-unknown-error.js";

describe("formatUnknownError", () => {
  it("preserves Error messages and JSON-serializable values", () => {
    expect(formatUnknownError(new Error("request failed"))).toBe("request failed");
    expect(formatUnknownError({ code: "EPIPE" })).toBe('{"code":"EPIPE"}');
    expect(formatUnknownError(undefined)).toBe("undefined");
    expect(formatUnknownError(10n)).toBe("10");
  });

  it("falls back safely for circular values", () => {
    const circular: Record<string, unknown> = { code: "ECONNRESET" };
    circular.self = circular;

    expect(formatUnknownError(circular)).toBe("[object Object]");
  });

  it("returns a fixed message when JSON and primitive conversion both throw", () => {
    const hostile = {
      toJSON() {
        throw new Error("toJSON failed");
      },
      [Symbol.toPrimitive]() {
        throw new Error("primitive conversion failed");
      },
    };

    expect(formatUnknownError(hostile)).toBe("Unknown error");
  });

  it("falls back to the Error message when custom formatting throws", () => {
    expect(
      formatUnknownError(new Error("request failed"), () => {
        throw new Error("status getter failed");
      }),
    ).toBe("request failed");
  });

  it("does not trust Error message accessors", () => {
    const hostile = new Error("request failed");
    Object.defineProperties(hostile, {
      message: {
        get() {
          throw new Error("message failed");
        },
      },
      name: {
        get() {
          throw new Error("name failed");
        },
      },
      toJSON: {
        value() {
          throw new Error("toJSON failed");
        },
      },
      [Symbol.toPrimitive]: {
        value() {
          throw new Error("primitive conversion failed");
        },
      },
    });

    expect(formatUnknownError(hostile)).toBe("Unknown error");
  });

  it("does not throw for a revoked proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(formatUnknownError(proxy)).toBe("Unknown error");
  });
});
