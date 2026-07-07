/**
 * Real behavior proof for #86711: store-visible ACP rows via production
 * listAcpSessionEntries, then startup reconcile skip for oneshot.
 *
 * Usage (from repo root, on the PR branch):
 *   pnpm exec tsx scripts/prove-acp-startup-oneshot-list-visible.ts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runManagerStartupIdentityReconcile } from "../src/acp/control-plane/manager.startup-identity-reconcile.ts";
import { listAcpSessionEntries, upsertAcpSessionMeta } from "../src/acp/runtime/session-meta.ts";
import type { OpenClawConfig } from "../src/config/types.openclaw.ts";

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-86711-proof-"));
  const storePath = path.join(dir, "sessions", "main.json");
  const databasePath = path.join(dir, "state", "openclaw.sqlite");
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const oneshotKey = "agent:main:acp:oneshot-proof-visible";
  const persistentKey = "agent:main:acp:persistent-proof-visible";
  const oneshotSessionId = "sess-oneshot-proof";
  const persistentSessionId = "sess-persistent-proof";

  // Session-store entries required for listAcpSessionEntries join (SQLite-only rows are dropped).
  await fs.writeFile(
    storePath,
    JSON.stringify({
      [oneshotKey]: { sessionId: oneshotSessionId, updatedAt: 1_700_000_000 },
      [persistentKey]: { sessionId: persistentSessionId, updatedAt: 1_700_000_000 },
    }),
    "utf8",
  );

  const cfg = { session: { store: storePath } } as OpenClawConfig;

  const pendingIdentity = (acpxSessionId: string) => ({
    backend: "acpx",
    agent: "main",
    runtimeSessionName: acpxSessionId,
    mode: "oneshot" as const,
    state: "completed" as const,
    lastActivityAt: 1_700_000_000,
    identity: {
      state: "pending" as const,
      source: "ensure" as const,
      acpxSessionId,
      lastUpdatedAt: 1_700_000_000,
    },
  });

  // Oneshot row: completed oneshot with pending identity + stable acpxSessionId.
  await upsertAcpSessionMeta({
    cfg,
    databasePath,
    sessionKey: oneshotKey,
    mutate: () => ({
      ...pendingIdentity("acpx-oneshot-stable"),
      mode: "oneshot",
      state: "completed",
    }),
  });

  // Persistent row: still pending identity; must remain reconcile-eligible.
  await upsertAcpSessionMeta({
    cfg,
    databasePath,
    sessionKey: persistentKey,
    mutate: () => ({
      ...pendingIdentity("acpx-persistent-stable"),
      mode: "persistent",
      state: "pending",
    }),
  });

  console.log("PROOF_DIR=" + dir);
  console.log("STORE_PATH=" + storePath);
  console.log("DATABASE_PATH=" + databasePath);

  const listed = await listAcpSessionEntries({ cfg, databasePath, clone: false });
  console.log("LIST_ACP_SESSION_ENTRIES_COUNT=" + listed.length);
  for (const entry of listed) {
    const identity = entry.acp?.identity;
    console.log(
      [
        "LIST_ROW",
        `sessionKey=${entry.sessionKey}`,
        `mode=${entry.acp?.mode ?? "?"}`,
        `state=${entry.acp?.state ?? "?"}`,
        `identityState=${identity && typeof identity === "object" && "state" in identity ? identity.state : "?"}`,
        `hasAcpxSessionId=${Boolean(
          identity &&
          typeof identity === "object" &&
          "acpxSessionId" in identity &&
          Boolean((identity as { acpxSessionId?: string }).acpxSessionId),
        )}`,
        `storeSessionId=${entry.entry?.sessionId ?? "?"}`,
      ].join(" "),
    );
  }

  const oneshotVisible = listed.some(
    (e) => e.sessionKey === oneshotKey && e.acp?.mode === "oneshot",
  );
  const persistentVisible = listed.some(
    (e) => e.sessionKey === persistentKey && e.acp?.mode === "persistent",
  );
  console.log("ONESHOT_STORE_VISIBLE=" + oneshotVisible);
  console.log("PERSISTENT_STORE_VISIBLE=" + persistentVisible);

  const ensureCalls: string[] = [];
  const result = await runManagerStartupIdentityReconcile({
    cfg,
    deps: {
      listAcpSessions: async (p) => listAcpSessionEntries({ ...p, databasePath, clone: false }),
    },
    withSessionActor: async (_key, fn) => fn(),
    resolveSession: ({ sessionKey }) => ({
      kind: "ready",
      sessionKey,
      meta: listed.find((e) => e.sessionKey === sessionKey)?.acp as never,
    }),
    ensureRuntimeHandle: async ({ sessionKey, meta }) => {
      ensureCalls.push(sessionKey);
      return {
        runtime: {} as never,
        handle: {} as never,
        meta,
      };
    },
    reconcileRuntimeSessionIdentifiers: async ({ sessionKey, meta }) => {
      // Leave identity pending so we observe eligibility (checked++) without claiming success.
      console.log(
        "RECONCILE_ELIGIBLE_CALL sessionKey=" +
          sessionKey +
          " mode=" +
          (meta as { mode?: string })?.mode,
      );
      return { meta, handle: {} as never };
    },
  });

  console.log(
    "RECONCILE_RESULT checked=" +
      result.checked +
      " resolved=" +
      result.resolved +
      " failed=" +
      result.failed,
  );
  console.log("ENSURE_CALLS=" + JSON.stringify(ensureCalls));
  console.log("ONESHOT_ENSURE_SKIPPED=" + !ensureCalls.includes(oneshotKey));
  console.log("PERSISTENT_ENSURE_CALLED=" + ensureCalls.includes(persistentKey));

  const ok =
    oneshotVisible &&
    persistentVisible &&
    listed.length === 2 &&
    result.checked === 1 &&
    !ensureCalls.includes(oneshotKey) &&
    ensureCalls.includes(persistentKey);

  console.log(ok ? "PROOF_OK" : "PROOF_FAIL");
  if (!ok) {
    process.exitCode = 1;
  }
}

await main();
