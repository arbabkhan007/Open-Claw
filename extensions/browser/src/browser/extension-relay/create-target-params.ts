export function resolveCreateTargetBackground(
  params: Record<string, unknown> | undefined,
): boolean {
  const background = params?.background;
  const focus = params?.focus;
  if (background === true && focus === true) {
    throw new Error("Target.createTarget does not support background=true with focus=true");
  }
  // OpenClaw changes only the fully omitted automation case to background.
  // Explicit focus keeps the CDP foreground semantics for both boolean values.
  if (focus === undefined) {
    return background !== false;
  }
  return background === true && focus === false;
}
