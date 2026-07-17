import { once } from "node:events";
import { createServer } from "node:http";
import { saveResponseMedia } from "openclaw/plugin-sdk/media-runtime";

let allPassed = true;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) allPassed = false;
}

// Real HTTP server: sends 200 media headers + one body chunk, then stalls
// forever. Emulates a Teams attachment host that dies mid-body.
const server = createServer((req, res) => {
  if (req.url === "/small") {
    const body = Buffer.from("PNGDATA!");
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": body.length });
    res.end(body);
    return;
  }
  if (req.url === "/trickle") {
    // Several small writes, each gap comfortably under the idle budget, but
    // the *total* transfer time exceeds it. A legitimate slow attachment
    // over a slow network must still complete, not be idle-killed for being
    // merely slow.
    res.writeHead(200, { "Content-Type": "image/png" });
    const chunks = [
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    ];
    let i = 0;
    const writeNext = () => {
      if (i >= chunks.length) {
        res.end();
        return;
      }
      res.write(chunks[i]);
      i += 1;
      setTimeout(writeNext, Math.floor(IDLE_MS * 0.4));
    };
    writeNext();
    return;
  }
  res.writeHead(200, { "Content-Type": "image/png" });
  res.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // no res.end(): body stalls after one chunk.
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("no server address");
const port = addr.port;
const IDLE_MS = 300;

try {
  // Case 1: stalled attachment save fails closed within the idle budget.
  {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/stall`);
    let err: Error | undefined;
    try {
      await saveResponseMedia(response, {
        sourceUrl: "https://teams.example.com/att.png",
        filePathHint: "att.png",
        maxBytes: 5 * 1024 * 1024,
        readIdleTimeoutMs: IDLE_MS,
      });
    } catch (e) {
      err = e as Error;
    }
    await response.body?.cancel().catch(() => {});
    const elapsed = Date.now() - started;
    check("stalled attachment save rejected (not hung)", !!err, `elapsed=${elapsed}ms`);
    check("save terminated (bounded, not infinite)", elapsed < 15_000, `elapsed=${elapsed}ms`);
    check(
      "idle-timeout failure surfaced",
      !!err && /(stalled|no data received)/i.test(err.message),
      err?.message ?? "",
    );
  }

  // Negative control: unbounded arrayBuffer() read on the same socket never
  // settles within a 2s observation window (the pre-fix hang).
  {
    const res = await fetch(`http://127.0.0.1:${port}/stall`);
    const raced = await Promise.race([
      res
        .arrayBuffer()
        .then(() => "resolved")
        .catch(() => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("still-hanging"), 2000)),
    ]);
    await res.body?.cancel().catch(() => {});
    check(
      "unbounded attachment read still hanging after 2000ms",
      raced === "still-hanging",
      `state=${raced}`,
    );
  }

  // Case 3: a complete small attachment still saves.
  {
    const response = await fetch(`http://127.0.0.1:${port}/small`);
    const saved = await saveResponseMedia(response, {
      sourceUrl: "https://teams.example.com/small.png",
      filePathHint: "small.png",
      maxBytes: 5 * 1024 * 1024,
      readIdleTimeoutMs: IDLE_MS,
    });
    check(
      "completing attachment saved",
      !!saved,
      JSON.stringify({ bytes: (saved as { byteLength?: number }).byteLength }),
    );
  }

  // Case 4 (compatibility): a slow-but-progressing attachment whose *total*
  // transfer time exceeds the idle budget, but whose per-chunk gaps never
  // do, must still complete. readIdleTimeoutMs is an idle bound, not a
  // wall-clock cap — killing this case would regress every real user on a
  // slow connection, not just hung requests.
  {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/trickle`);
    const saved = await saveResponseMedia(response, {
      sourceUrl: "https://teams.example.com/trickle.png",
      filePathHint: "trickle.png",
      maxBytes: 5 * 1024 * 1024,
      readIdleTimeoutMs: IDLE_MS,
    });
    const elapsed = Date.now() - started;
    check(
      "slow-but-progressing attachment (total time > idle budget) still saved",
      !!saved,
      `elapsed=${elapsed}ms, idleBudget=${IDLE_MS}ms`,
    );
  }
} finally {
  server.close();
}

console.log(allPassed ? "\nALL PROOF ASSERTIONS PASSED" : "\nSOME ASSERTIONS FAILED");
process.exit(allPassed ? 0 : 1);
