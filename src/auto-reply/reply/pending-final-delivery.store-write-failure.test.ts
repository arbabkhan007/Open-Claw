// Real behavior proof for PR #102128:
// shows requireWriteSuccess:true propagates a store write failure as a thrown
// error for the pendingFinalDelivery write path.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { updateSessionEntry } from "../../config/sessions/session-accessor.js";
import { saveSessionStore } from "../../config/sessions/store.js";
import * as jsonFiles from "../../infra/json-files.js";

describe("pendingFinalDelivery requireWriteSuccess", () => {
  const tempDirTracker = useAutoCleanupTempDirTracker(afterEach);
  let storePath: string;
  const sessionKey = "main";

  beforeEach(() => {
    storePath = path.join(tempDirTracker.make("pfd-proof-"), "sessions.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates store write failure WITH requireWriteSuccess:true (PR #102128)", async () => {
    // Arrange: fresh session entry in the store
    await saveSessionStore(
      storePath,
      { [sessionKey]: { sessionId: "session", updatedAt: Date.now() } },
      { skipMaintenance: true },
    );

    // Inject a store write failure — ENOENT is the code the store checks
    const writeError = Object.assign(new Error("write failed: ENOENT"), { code: "ENOENT" });
    vi.spyOn(jsonFiles, "writeTextAtomic").mockRejectedValue(writeError);

    // Act + Assert: with requireWriteSuccess:true, the error propagates
    await expect(
      updateSessionEntry(
        { storePath, sessionKey },
        () => ({
          pendingFinalDelivery: true,
          pendingFinalDeliveryText: "hello from proof test",
          pendingFinalDeliveryContext: {},
          pendingFinalDeliveryCreatedAt: Date.now(),
          updatedAt: Date.now(),
        }),
        {
          skipMaintenance: true,
          takeCacheOwnership: true,
          requireWriteSuccess: true, // <-- THE PR CHANGE
        },
      ),
    ).rejects.toThrow("write failed: ENOENT");
  });
});
