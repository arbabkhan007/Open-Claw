// Loopback proof: dripping LINE content bodies cannot outlive the body deadline.
import { once } from "node:events";
import * as http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const saveMediaStreamMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  createSubsystemLogger: () => {
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => logger,
    };
    return logger;
  },
  logVerbose: () => {},
}));

vi.mock("openclaw/plugin-sdk/media-store", () => ({
  saveMediaStream: saveMediaStreamMock,
}));

describe("LINE media download wall-clock loopback", () => {
  let server: http.Server | undefined;
  const dripTimers = new Set<ReturnType<typeof setInterval>>();
  let downloadLineMedia: typeof import("./download.js").downloadLineMedia;

  afterEach(async () => {
    for (const timer of dripTimers) {
      clearInterval(timer);
    }
    dripTimers.clear();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
        server?.closeAllConnections?.();
      });
      server = undefined;
    }
    vi.resetModules();
  });

  it("aborts a dripping content body within the body wall-clock deadline", async () => {
    saveMediaStreamMock.mockReset();
    saveMediaStreamMock.mockImplementation(async (stream: AsyncIterable<Buffer>) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return {
        path: "/tmp/line-media-loopback",
        contentType: "application/octet-stream",
        size: Buffer.concat(chunks).length,
      };
    });

    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const timer = setInterval(() => {
        res.write("x");
      }, 40);
      dripTimers.add(timer);
      res.on("close", () => {
        clearInterval(timer);
        dripTimers.delete(timer);
      });
    });
    server.on("clientError", (_err, socket) => socket.destroy());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected loopback server address");
    }
    const contentBaseUrl = `http://127.0.0.1:${address.port}/v2/bot/message`;

    ({ downloadLineMedia } = await import("./download.js"));

    const startedAt = Date.now();
    await expect(
      downloadLineMedia("mid-drip", "token", 10 * 1024 * 1024, {
        bodyTimeoutMs: 250,
        contentBaseUrl,
      }),
    ).rejects.toThrow(/body for message mid-drip timed out after 0\.25 seconds/i);
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(200);
    expect(elapsedMs).toBeLessThan(2_000);
    expect(saveMediaStreamMock).toHaveBeenCalledTimes(1);
  });

  it("persists a slow-but-valid body before the body deadline", async () => {
    saveMediaStreamMock.mockReset();
    saveMediaStreamMock.mockImplementation(async (stream: AsyncIterable<Buffer>) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return {
        path: "/tmp/line-media-loopback-ok",
        contentType: "application/octet-stream",
        size: Buffer.concat(chunks).length,
      };
    });

    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      setTimeout(() => {
        res.write("ok");
        res.end();
      }, 80);
    });
    server.on("clientError", (_err, socket) => socket.destroy());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected loopback server address");
    }
    const contentBaseUrl = `http://127.0.0.1:${address.port}/v2/bot/message`;

    ({ downloadLineMedia } = await import("./download.js"));

    const result = await downloadLineMedia("mid-slow-ok", "token", 10 * 1024 * 1024, {
      bodyTimeoutMs: 1_500,
      contentBaseUrl,
    });
    expect(result.size).toBe(2);
    expect(saveMediaStreamMock).toHaveBeenCalledTimes(1);
  });
});
