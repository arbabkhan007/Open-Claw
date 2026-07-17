import { areUiSessionKeysEquivalent } from "../../lib/sessions/session-key.ts";
import {
  chatScopedEventSessionMatches,
  loadChatHistory,
  type ChatEventPayload,
  type ChatState,
} from "./chat-history.ts";
import { needsManagedOutgoingImageCoordinateReload } from "./managed-image-preview.ts";

type ManagedImageReloadHost = ChatState & {
  pendingSessionMessageReloadSessionKey: string | null;
  requestUpdate?: () => void;
};

export function replayPendingSessionMessageReload(
  state: ManagedImageReloadHost,
  payload: ChatEventPayload | undefined,
): boolean {
  const pendingSessionKey = state.pendingSessionMessageReloadSessionKey;
  const payloadSessionKey = payload?.sessionKey?.trim();
  if (
    !pendingSessionKey ||
    !payloadSessionKey ||
    !areUiSessionKeysEquivalent(pendingSessionKey, payloadSessionKey) ||
    !areUiSessionKeysEquivalent(payloadSessionKey, state.sessionKey) ||
    state.chatRunId
  ) {
    return false;
  }
  state.pendingSessionMessageReloadSessionKey = null;
  void loadChatHistory(state).finally(() => state.requestUpdate?.());
  return true;
}

export function reloadFinalManagedImageCoordinates(
  state: ManagedImageReloadHost,
  payload: ChatEventPayload | undefined,
): void {
  if (
    payload?.state !== "final" ||
    !payload.sessionKey ||
    !chatScopedEventSessionMatches(state, payload.sessionKey, payload.agentId) ||
    !needsManagedOutgoingImageCoordinateReload(payload.message)
  ) {
    return;
  }
  if (state.chatRunId) {
    state.pendingSessionMessageReloadSessionKey = payload.sessionKey;
    return;
  }
  void loadChatHistory(state).finally(() => state.requestUpdate?.());
}
