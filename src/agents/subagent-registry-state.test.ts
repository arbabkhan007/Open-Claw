// Subagent registry state tests cover hot read caching over the persisted SQLite snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSubagentRunsReadCacheForTest,
  getSubagentRunsSnapshotForChildSession,
  getSubagentRunsSnapshotForController,
  getSubagentRunsSnapshotForRead,
  persistSubagentRunsToDisk,
  persistSubagentRunsToDiskOrThrow,
} from "./subagent-registry-state.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const mocks = vi.hoisted(() => ({
  loadSubagentRunsForChildSessionFromSqlite:
    vi.fn<(childSessionKey: string) => SubagentRunRecord[]>(),
  loadSubagentRunsForControllerFromSqlite:
    vi.fn<(controllerSessionKey: string) => SubagentRunRecord[]>(),
  loadSubagentRegistryFromSqlite: vi.fn<() => Map<string, SubagentRunRecord>>(),
  saveSubagentRegistryToSqlite: vi.fn<(runs: Map<string, SubagentRunRecord>) => void>(),
}));

vi.mock("./subagent-registry.store.sqlite.js", () => ({
  loadSubagentRunsForChildSessionFromSqlite: mocks.loadSubagentRunsForChildSessionFromSqlite,
  loadSubagentRunsForControllerFromSqlite: mocks.loadSubagentRunsForControllerFromSqlite,
  loadSubagentRegistryFromSqlite: mocks.loadSubagentRegistryFromSqlite,
  saveSubagentRegistryToSqlite: mocks.saveSubagentRegistryToSqlite,
}));

function createRun(runId: string): SubagentRunRecord {
  return {
    runId,
    childSessionKey: `agent:main:subagent:${runId}`,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: `task ${runId}`,
    cleanup: "keep",
    createdAt: 1,
    startedAt: 1,
  };
}

describe("subagent registry state read cache", () => {
  const previousReadSqliteFlag = process.env.OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    process.env.OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE = "1";
    clearSubagentRunsReadCacheForTest();
    mocks.loadSubagentRunsForChildSessionFromSqlite.mockReset();
    mocks.loadSubagentRunsForControllerFromSqlite.mockReset();
    mocks.loadSubagentRegistryFromSqlite.mockReset();
    mocks.saveSubagentRegistryToSqlite.mockReset();
  });

  afterEach(() => {
    clearSubagentRunsReadCacheForTest();
    if (previousReadSqliteFlag === undefined) {
      delete process.env.OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE;
    } else {
      process.env.OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE = previousReadSqliteFlag;
    }
    vi.useRealTimers();
  });

  it("reuses persisted snapshots for hot reads within the ttl", () => {
    const firstRun = createRun("run-first");
    const secondRun = createRun("run-second");
    mocks.loadSubagentRegistryFromSqlite
      .mockReturnValueOnce(new Map([[firstRun.runId, firstRun]]))
      .mockReturnValueOnce(new Map([[secondRun.runId, secondRun]]));

    expect([...getSubagentRunsSnapshotForRead(new Map()).keys()]).toEqual(["run-first"]);
    expect([...getSubagentRunsSnapshotForRead(new Map()).keys()]).toEqual(["run-first"]);
    expect(mocks.loadSubagentRegistryFromSqlite).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);

    expect([...getSubagentRunsSnapshotForRead(new Map()).keys()]).toEqual(["run-second"]);
    expect(mocks.loadSubagentRegistryFromSqlite).toHaveBeenCalledTimes(2);
  });

  it("refreshes the local read cache after successful writes", () => {
    const firstRun = createRun("run-first");
    const savedRun = createRun("run-saved");
    mocks.loadSubagentRegistryFromSqlite.mockReturnValue(new Map([[firstRun.runId, firstRun]]));

    expect([...getSubagentRunsSnapshotForRead(new Map()).keys()]).toEqual(["run-first"]);

    persistSubagentRunsToDisk(new Map([[savedRun.runId, savedRun]]));

    expect([...getSubagentRunsSnapshotForRead(new Map()).keys()]).toEqual(["run-saved"]);
    expect(mocks.saveSubagentRegistryToSqlite).toHaveBeenCalledOnce();
    expect(mocks.loadSubagentRegistryFromSqlite).toHaveBeenCalledTimes(1);
  });

  it("refreshes persisted controller snapshots when the ttl expires", () => {
    const persistedRun = createRun("persisted");
    persistedRun.controllerSessionKey = "agent:main:controller";
    const refreshedRun = createRun("refreshed");
    refreshedRun.controllerSessionKey = "agent:main:controller";
    mocks.loadSubagentRunsForControllerFromSqlite
      .mockReturnValueOnce([persistedRun])
      .mockReturnValueOnce([refreshedRun]);

    expect([
      ...getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").keys(),
    ]).toEqual(["persisted"]);
    expect([
      ...getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").keys(),
    ]).toEqual(["persisted"]);
    expect(mocks.loadSubagentRunsForControllerFromSqlite).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);

    expect([
      ...getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").keys(),
    ]).toEqual(["refreshed"]);
    expect(mocks.loadSubagentRunsForControllerFromSqlite).toHaveBeenCalledTimes(2);
  });

  it("keeps controller and child cache entries separate when their keys match", () => {
    const sessionKey = "agent:main:subagent:shared-key";
    const controllerRun = createRun("controller-run");
    controllerRun.controllerSessionKey = sessionKey;
    const childRun = createRun("child-run");
    childRun.childSessionKey = sessionKey;
    mocks.loadSubagentRunsForControllerFromSqlite.mockReturnValue([controllerRun]);
    mocks.loadSubagentRunsForChildSessionFromSqlite.mockReturnValue([childRun]);

    expect(
      getSubagentRunsSnapshotForController(new Map(), sessionKey).has(controllerRun.runId),
    ).toBe(true);
    expect(getSubagentRunsSnapshotForChildSession(new Map(), sessionKey).has(childRun.runId)).toBe(
      true,
    );
    expect(mocks.loadSubagentRunsForControllerFromSqlite).toHaveBeenCalledWith(sessionKey);
    expect(mocks.loadSubagentRunsForChildSessionFromSqlite).toHaveBeenCalledWith(sessionKey);
  });

  it("uses isolated child snapshots and overlays matching in-memory runs", () => {
    const childSessionKey = "agent:main:subagent:child";
    const persisted = createRun("persisted-child");
    persisted.childSessionKey = childSessionKey;
    persisted.task = "persisted task";
    const inMemory = { ...persisted, task: "in-memory task" };
    mocks.loadSubagentRunsForChildSessionFromSqlite.mockReturnValue([persisted]);

    const first = getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey);
    first.get(persisted.runId)!.task = "mutated result";
    const second = getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey);

    expect(second.get(inMemory.runId)?.task).toBe("persisted task");
    expect(
      getSubagentRunsSnapshotForChildSession(
        new Map([[inMemory.runId, inMemory]]),
        childSessionKey,
      ).get(inMemory.runId)?.task,
    ).toBe("in-memory task");
    expect(mocks.loadSubagentRunsForChildSessionFromSqlite).toHaveBeenCalledTimes(1);
  });

  it("clears child snapshots after a successful throwing persistence write", () => {
    const childSessionKey = "agent:main:subagent:child";
    const previous = createRun("previous-child");
    previous.childSessionKey = childSessionKey;
    const replacement = createRun("replacement-child");
    replacement.childSessionKey = childSessionKey;
    mocks.loadSubagentRunsForChildSessionFromSqlite
      .mockReturnValueOnce([previous])
      .mockReturnValueOnce([replacement]);

    expect(
      getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey).has(previous.runId),
    ).toBe(true);
    persistSubagentRunsToDiskOrThrow(new Map([[replacement.runId, replacement]]));

    expect([...getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey).keys()]).toEqual([
      replacement.runId,
    ]);
  });

  it("clears child snapshots after a successful best-effort persistence write", () => {
    const childSessionKey = "agent:main:subagent:child";
    const previous = createRun("previous-child");
    previous.childSessionKey = childSessionKey;
    const replacement = createRun("replacement-child");
    replacement.childSessionKey = childSessionKey;
    mocks.loadSubagentRunsForChildSessionFromSqlite
      .mockReturnValueOnce([previous])
      .mockReturnValueOnce([replacement]);

    expect(
      getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey).has(previous.runId),
    ).toBe(true);
    persistSubagentRunsToDisk(new Map([[replacement.runId, replacement]]));

    expect([...getSubagentRunsSnapshotForChildSession(new Map(), childSessionKey).keys()]).toEqual([
      replacement.runId,
    ]);
  });

  it("keeps at most 64 fresh controller snapshots", () => {
    mocks.loadSubagentRunsForControllerFromSqlite.mockImplementation((controllerSessionKey) => [
      createRun(`run-${controllerSessionKey}`),
    ]);

    for (let index = 0; index <= 64; index += 1) {
      getSubagentRunsSnapshotForController(new Map(), `agent:main:controller-${index}`);
    }

    getSubagentRunsSnapshotForController(new Map(), "agent:main:controller-0");

    expect(mocks.loadSubagentRunsForControllerFromSqlite).toHaveBeenCalledTimes(66);
  });

  it("does not query persisted runs for an empty controller key", () => {
    expect(getSubagentRunsSnapshotForController(new Map(), "   ")).toEqual(new Map());
    expect(mocks.loadSubagentRunsForControllerFromSqlite).not.toHaveBeenCalled();
  });

  it("overrides a persisted controller run with the in-memory record", () => {
    const persistedRun = createRun("shared");
    persistedRun.controllerSessionKey = "agent:main:controller";
    persistedRun.task = "persisted task";
    const inMemoryRun = { ...persistedRun, task: "in-memory task" };
    mocks.loadSubagentRunsForControllerFromSqlite.mockReturnValue([persistedRun]);

    const result = getSubagentRunsSnapshotForController(
      new Map([[inMemoryRun.runId, inMemoryRun]]),
      "agent:main:controller",
    );

    expect(result.get("shared")?.task).toBe("in-memory task");
  });

  it("clears a scoped entry after a throwing persistence write", () => {
    const oldRun = createRun("old");
    oldRun.controllerSessionKey = "agent:main:controller";
    const replacement = createRun("replacement");
    replacement.controllerSessionKey = "agent:main:controller";
    mocks.loadSubagentRunsForControllerFromSqlite
      .mockReturnValueOnce([oldRun])
      .mockReturnValueOnce([replacement]);

    expect(
      getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").has("old"),
    ).toBe(true);

    persistSubagentRunsToDiskOrThrow(new Map([[replacement.runId, replacement]]));

    expect([
      ...getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").keys(),
    ]).toEqual(["replacement"]);
  });

  it("clears a scoped entry after a best-effort persistence write", () => {
    const oldRun = createRun("old");
    oldRun.controllerSessionKey = "agent:main:controller";
    const replacement = createRun("replacement");
    replacement.controllerSessionKey = "agent:main:controller";
    mocks.loadSubagentRunsForControllerFromSqlite
      .mockReturnValueOnce([oldRun])
      .mockReturnValueOnce([replacement]);

    expect(
      getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").has("old"),
    ).toBe(true);

    persistSubagentRunsToDisk(new Map([[replacement.runId, replacement]]));

    expect([
      ...getSubagentRunsSnapshotForController(new Map(), "agent:main:controller").keys(),
    ]).toEqual(["replacement"]);
  });
});
