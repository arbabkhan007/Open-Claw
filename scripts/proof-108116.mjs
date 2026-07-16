// Local real-behavior proof for PR #108116.
// Starts a real HTTP server that sends response headers for a managed outgoing
// image and then stalls the body forever. A real fetch is made through the
// same resolver used by the Control UI chat message component. The resolver
// must exit its pending state after the deadline and return null (fallback)
// instead of hanging or rethrowing.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const TIME_SCALE = 100; // Speed up the 30 s deadline so the proof runs quickly.
const REAL_DEADLINE_MS = 30_000;

// --- Browser globals required by the UI module when loaded in Node ---

globalThis.window = { location: { origin: "" } };
globalThis.URL.createObjectURL = (blob) => `blob:proof-${blob.size}-${blob.type}`;

const { resolveManagedOutgoingImageBlobUrl } =
  await import("../ui/src/pages/chat/components/chat-message.ts");

function startStallingServer() {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "", `http://${request.headers.host}`);
    console.log(`[server] ${request.method} ${pathname}`);
    if (pathname.startsWith("/api/chat/media/outgoing/")) {
      // Send headers immediately, then never finish the body.
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": "1024",
      });
      console.log("[server] headers sent; body will stall");
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const origin = `http://${address.address}:${address.port}`;
      console.log(`[server] listening at ${origin}`);
      resolve({ server, origin });
    });
  });
}

function scaleTimers(factor) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...args) => {
    const scaled = typeof ms === "number" ? Math.max(1, Math.floor(ms / factor)) : ms;
    return originalSetTimeout(callback, scaled, ...args);
  };
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}

async function main() {
  const { server, origin } = await startStallingServer();
  globalThis.window.location.origin = origin;

  const sessionKey = "agent:main:main";
  const mediaId = randomUUID();
  const source = `${origin}/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${mediaId}/full`;

  console.log(`[proof] fetching ${source}`);
  console.log(
    `[proof] scaling timers by ${TIME_SCALE}x (deadline ~${REAL_DEADLINE_MS / TIME_SCALE} ms real time)`,
  );

  const restoreTimers = scaleTimers(TIME_SCALE);
  const startedAt = Date.now();
  let result;
  let threw = null;
  try {
    result = await resolveManagedOutgoingImageBlobUrl(source);
  } catch (error) {
    threw = error;
  } finally {
    restoreTimers();
  }
  const elapsedMs = Date.now() - startedAt;

  console.log(`[proof] resolved in ${elapsedMs} ms`);
  if (threw) {
    console.error(
      `[proof] ERROR: resolver threw instead of falling back: ${threw.name}: ${threw.message}`,
    );
    server.closeAllConnections();
    server.close();
    process.exitCode = 1;
    return;
  }
  if (result !== null) {
    console.error(`[proof] ERROR: resolver returned non-null result: ${result}`);
    server.closeAllConnections();
    server.close();
    process.exitCode = 1;
    return;
  }

  console.log("[proof] OK: stalled managed outgoing image fetch timed out and fell back to null");
  server.closeAllConnections();
  server.close();
}

main().catch((error: unknown) => {
  console.error("[proof] unexpected error:", error);
  process.exitCode = 1;
});
