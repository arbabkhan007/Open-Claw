export const CHAT_OPEN_DETAILS_SELECTOR =
  ".chat-controls__inline-select[open], .context-usage details[open], .agent-chat__attach-menu[open], .chat-pr__checks[open]";
export const CHAT_COMPOSER_TEXTAREA_SELECTOR = ".agent-chat__composer-combobox > textarea";
export const CHAT_TEXT_ENTRY_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='combobox'], [role='listbox'], [role='textbox']";
export const CHAT_SPACE_ACTIVATION_SELECTOR =
  "a[href], button, summary, [role='button'], [role='checkbox'], [role='link'], [role='radio'], [role='switch']";
export const CHAT_MODAL_SELECTOR = "dialog[open], [aria-modal='true']";

// Pane-width thresholds use the pane itself because split panes can be much
// narrower than the viewport. The rail needs room for chat plus its 280px cap;
// the detail panel needs both of its CSS minimum widths plus divider slack.
export const WORKSPACE_RAIL_SIDE_MIN_PANE_WIDTH = 800;
export const WORKSPACE_RAIL_MAX_WIDTH = 280;
export const DETAIL_SIDEBAR_SIDE_MIN_WIDTH = 680;
export const NEW_SESSION_MESSAGE = {
  activeRun: "Start a new session after the active run or queued messages finish.",
  listLoading: "Session list is still refreshing. Try New Chat again in a moment.",
  createFailed: "New Chat could not create a new session. Try again in a moment.",
} as const;

export function keyboardEventPathMatches(event: KeyboardEvent, selector: string): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof Element && target.matches(selector));
}
