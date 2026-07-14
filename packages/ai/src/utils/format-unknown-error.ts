const UNKNOWN_ERROR_MESSAGE = "Unknown error";

/** Formats a thrown value without risking a second failure in stream cleanup. */
export function formatUnknownError(
  value: unknown,
  formatError?: (error: Error) => string | undefined,
): string {
  try {
    if (value instanceof Error) {
      try {
        const formatted = formatError?.(value);
        if (formatted) {
          return formatted;
        }
      } catch {
        // Provider-specific detail extraction is optional; retain the base Error message.
      }
      try {
        return value.message || value.name || UNKNOWN_ERROR_MESSAGE;
      } catch {
        // Error subclasses can expose throwing message/name accessors.
      }
    }
  } catch {
    // Hostile proxies can throw during instanceof; keep the terminal error path moving.
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined && serialized.length > 0) {
      return serialized;
    }
  } catch {
    // Circular values and throwing toJSON hooks fall through to primitive conversion.
  }

  try {
    const text = String(value);
    if (text.length > 0) {
      return text;
    }
  } catch {
    // A throwing Symbol.toPrimitive must not prevent the stream from terminating.
  }

  return UNKNOWN_ERROR_MESSAGE;
}
