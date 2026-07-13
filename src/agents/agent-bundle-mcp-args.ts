/** Coerces untrusted MCP utility tool arguments into typed values. */
export function requireStringArg(input: unknown, key: string): string {
  if (!input || typeof input !== "object") {
    throw new Error(`${key} is required`);
  }
  const value = Reflect.get(input, key);
  if (typeof value !== "string") {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function optionalStringRecordArg(
  input: unknown,
  key: string,
): Record<string, string> | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b));
  const invalid = entries.find((entry) => typeof entry[1] !== "string");
  if (invalid) {
    throw new Error(`${key}.${invalid[0]} must be a string`);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
