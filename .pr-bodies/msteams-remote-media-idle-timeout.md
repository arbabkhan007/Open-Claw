## What Problem This Solves

Fixes an issue where Microsoft Teams inbound remote media saves could hang indefinitely when an attachment response returned headers and then stalled mid-body. `saveResponseMedia` / `saveRemoteMedia` were called without `readIdleTimeoutMs` (and without a header timeout on the runtime path), so a chunk stall never failed closed.

## Why This Change Was Made

Pass the same media timeout policy already used by Mattermost/Zalo/Tlon: `responseHeaderTimeoutMs: 120_000` and `readIdleTimeoutMs: 30_000` through every production caller that hands a response to `saveResponseMedia`/`saveRemoteMedia`, not just the direct-fetch path.

The initial revision only bounded `remote-media.ts`'s two callers. Review found two more production Teams response-save callers on the exact same `saveResponseMedia` primitive that were still unbounded: the Bot Framework attachment view save (`bot-framework.ts`) and the Graph hosted-content `$value` save (`graph.ts`). Both are on the personal-DM (`a:`/`8:orgid:`) and Graph-hosted-image inbound paths respectively, so a stall on either leaves the same class of hang the direct path was fixed for. `MSTEAMS_MEDIA_READ_IDLE_TIMEOUT_MS`/`MSTEAMS_MEDIA_RESPONSE_HEADER_TIMEOUT_MS` moved to `shared.ts` so all three callers reference one constant instead of drifting.

## User Impact

**Before:** A stalled Teams attachment download body could hang inbound media persistence forever — on the direct SharePoint path, the Bot Framework personal-chat attachment path, or the Graph hosted-content path.

**After:** All three attachment body reads fail closed after 30s of idle (and header waits after 120s on the guarded path), so the inbound turn can surface a media failure instead of hanging.

## Evidence

- Changed: `extensions/msteams/src/attachments/shared.ts` (shared idle/header timeout constants), `extensions/msteams/src/attachments/remote-media.ts`, `extensions/msteams/src/attachments/bot-framework.ts`, `extensions/msteams/src/attachments/graph.ts`, plus their `*.test.ts` regression coverage, and `scripts/proof-msteams-media-idle-timeout.mts` (real-socket proof, now checked in)
- Production caller paths, all bottoming out on the same `saveResponseMedia` (`openclaw/plugin-sdk/media-runtime`):
  - `downloadAndStoreMSTeamsRemoteMedia` → `saveRemoteMediaDirect` → `saveResponseMedia({ readIdleTimeoutMs: 30_000 })`, and the non-direct path → `saveRemoteMedia({ responseHeaderTimeoutMs: 120_000, readIdleTimeoutMs: 30_000 })`
  - `downloadMSTeamsBotFrameworkAttachments` → `downloadMSTeamsBotFrameworkAttachment` → `saveBotFrameworkAttachmentView` → `saveResponseMedia({ readIdleTimeoutMs: 30_000 })` (`bot-framework.ts:197`)
  - `downloadMSTeamsGraphMedia` → `downloadGraphHostedContent` → `saveResponseMedia({ readIdleTimeoutMs: 30_000 })` (`graph.ts:206`)

## Real behavior proof

### Behavior or issue addressed

All three Teams response-save callers now forward the same idle-read (and, where applicable, header) timeout, and a slow-but-progressing transfer whose _total_ time exceeds the idle budget still completes instead of being killed for merely being slow.

### Real environment tested

Real HTTP transport: a local `node:http` server on `127.0.0.1` driven with four behaviors — headers plus one chunk then permanent silence (stall), headers with no idle timeout at all (negative control proving the pre-fix hang), a small immediate 200, and a 200 delivered in three small chunks each well under the idle budget but whose combined transfer time exceeds it (compatibility case). The production `saveResponseMedia` (from `openclaw/plugin-sdk/media-runtime` — the exact function all three Teams save callers now pass `readIdleTimeoutMs` into) is driven directly against those live sockets with a temp `OPENCLAW_STATE_DIR` media store, Node v22.23.1. The two new production callers (`bot-framework.ts`, `graph.ts`) are additionally covered by focused vitest regressions asserting `readIdleTimeoutMs: 30_000` is forwarded at their exact `saveResponseMedia` call sites.

### Exact steps or command run after this patch

```bash
# Real HTTP server: stall, negative control, small success, and slow-trickle
# compatibility case, all driven through the production saveResponseMedia:
OPENCLAW_STATE_DIR=$(mktemp -d) node --import tsx scripts/proof-msteams-media-idle-timeout.mts

# Focused regressions for all three save callers plus the shared constants:
node scripts/run-vitest.mjs extensions/msteams/src/attachments/remote-media.test.ts extensions/msteams/src/attachments/bot-framework.test.ts extensions/msteams/src/attachments/graph.test.ts --reporter=dot

# Full extension suite (no regressions):
node scripts/run-vitest.mjs extensions/msteams
```

### Evidence after fix

Real HTTP stall and compatibility proof (production Teams save path against live sockets):

```text
  ok: stalled attachment save rejected (not hung) — elapsed=542ms
  ok: save terminated (bounded, not infinite) — elapsed=542ms
  ok: idle-timeout failure surfaced — Failed to fetch media from https://teams.example.com/att.png: Media download stalled: no data received for 300ms
  ok: unbounded attachment read still hanging after 2000ms — state=still-hanging
  ok: completing attachment saved — {}
  ok: slow-but-progressing attachment (total time > idle budget) still saved — elapsed=369ms, idleBudget=300ms

ALL PROOF ASSERTIONS PASSED
```

Full extension suite: 74 files / 1108 tests passed, including the two new `readIdleTimeoutMs` forwarding regressions on `bot-framework.ts` and `graph.ts`.

### Observed result after fix

Against a real stalled `image/png` socket, `saveResponseMedia` fails closed in ~542ms with `Media download stalled: no data received for 300ms` and releases the connection; the negative control (unbounded `arrayBuffer()` on the same socket) is still unresolved after a 2000ms observation window, confirming the pre-fix hang shape. A well-behaved completing attachment still saves, and — the compatibility guarantee — an attachment delivered in three small chunks whose _total_ delivery time (369ms) exceeds the 300ms idle budget still saves in full, because `readIdleTimeoutMs` resets on every chunk rather than capping wall-clock time; only true silence trips it. The two newly-bounded production callers (`bot-framework.ts`, `graph.ts`) are proven by regression to forward the identical `readIdleTimeoutMs: 30_000` into the same `saveResponseMedia` primitive this real-socket proof exercises.

### What was not tested

Live stall against a real Microsoft Teams attachment host, Bot Framework connector, or Graph endpoint.

### Fix classification

bugfix — timeout/hang

## AI Assistance

AI-assisted. Author reviewed the Teams media save timeout wiring (including the two additional caller sites found by review), the shared-constant consolidation, and the caller-path proof output.
