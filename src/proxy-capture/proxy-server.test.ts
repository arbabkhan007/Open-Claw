import { EventEmitter } from "node:events";
// Proxy capture server tests cover request recording and response handling.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  request as httpRequest,
  createServer as createHttpServer,
  type IncomingMessage,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import type { DebugProxySettings } from "./env.js";
import {
  parseConnectTarget,
  pipeUpstreamBodyToClient,
  startDebugProxyServer,
} from "./proxy-server.js";
import { closeDebugProxyCaptureStore, getDebugProxyCaptureStore } from "./store.sqlite.js";

let testRoot: string | undefined;
const originalStateDir = process.env.OPENCLAW_STATE_DIR;

async function cleanupTestRoot(): Promise<void> {
  closeDebugProxyCaptureStore();
  closeOpenClawStateDatabaseForTest();
  if (originalStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = originalStateDir;
  }
  if (!testRoot) {
    return;
  }
  const root = testRoot;
  testRoot = undefined;
  await rm(root, { recursive: true, force: true });
}

async function makeSettings(): Promise<DebugProxySettings> {
  testRoot = await mkdtemp(join(tmpdir(), "openclaw-debug-proxy-server-"));
  const certDir = join(testRoot, "certs");
  await mkdir(certDir, { recursive: true });
  await writeFile(join(certDir, "root-ca.pem"), "test root cert\n", "utf8");
  await writeFile(join(certDir, "root-ca-key.pem"), "test root key\n", "utf8");
  process.env.OPENCLAW_STATE_DIR = testRoot;
  return {
    enabled: true,
    required: false,
    dbPath: join(testRoot, "capture.sqlite"),
    blobDir: join(testRoot, "blobs"),
    certDir,
    sessionId: "debug-proxy-server-test",
    sourceProcess: "test",
  };
}

async function startLargeBodyOrigin(responseBody: string): Promise<{
  receivedRequestBody: () => string;
  responseBody: string;
  stop: () => Promise<void>;
  url: string;
}> {
  let receivedBody = "";
  const server = createHttpServer((req, res) => {
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      receivedBody += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, {
        "content-length": Buffer.byteLength(responseBody),
        "content-type": "text/plain; charset=utf-8",
      });
      res.end(responseBody);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    receivedRequestBody: () => receivedBody,
    responseBody,
    stop: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    url: `http://127.0.0.1:${address.port}/capture`,
  };
}

async function startResponseErrorOrigin(): Promise<{
  stop: () => Promise<void>;
  url: string;
}> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/before-headers") {
      res.socket?.destroy();
      return;
    }
    if (req.url === "/after-headers") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.flushHeaders();
      res.write("partial");
      setTimeout(() => res.socket?.destroy(), 50);
      return;
    }
    res.writeHead(200, {
      "content-length": 2,
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    stop: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    url: `http://127.0.0.1:${address.port}`,
  };
}

type ProxyResponseResult = {
  body: string;
  complete: boolean;
  errorMessage?: string;
  statusCode?: number;
};

async function getThroughProxy(proxyUrl: string, targetUrl: string): Promise<ProxyResponseResult> {
  const proxy = new URL(proxyUrl);
  return await new Promise<ProxyResponseResult>((resolve) => {
    let settled = false;
    let body = "";
    let response: IncomingMessage | undefined;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        body,
        complete: response?.complete ?? false,
        ...(error ? { errorMessage: error.message } : {}),
        ...(response?.statusCode === undefined ? {} : { statusCode: response.statusCode }),
      });
    };
    const req = httpRequest(
      {
        host: proxy.hostname,
        port: Number(proxy.port),
        method: "GET",
        path: targetUrl,
        headers: { connection: "close" },
      },
      (res) => {
        response = res;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => finish());
        res.on("error", finish);
        res.on("close", () => {
          if (!res.complete) {
            finish(new Error("response closed before completion"));
          }
        });
      },
    );
    req.on("error", finish);
    req.end();
  });
}

async function postThroughProxy(params: {
  body: string;
  proxyUrl: string;
  targetUrl: string;
}): Promise<string> {
  const proxy = new URL(params.proxyUrl);
  return await new Promise<string>((resolve, reject) => {
    const req = httpRequest(
      {
        host: proxy.hostname,
        port: Number(proxy.port),
        method: "POST",
        path: params.targetUrl,
        headers: {
          connection: "close",
          "content-length": Buffer.byteLength(params.body),
          "content-type": "text/plain; charset=utf-8",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("error", reject);
    req.end(params.body);
  });
}

afterEach(async () => {
  await cleanupTestRoot();
});

describe("parseConnectTarget", () => {
  it("parses bracketed IPv6 CONNECT targets safely", () => {
    expect(parseConnectTarget("[::1]:8443")).toEqual({
      hostname: "::1",
      port: 8443,
    });
  });

  it("parses unbracketed host:port CONNECT targets", () => {
    expect(parseConnectTarget("api.openai.com:443")).toEqual({
      hostname: "api.openai.com",
      port: 443,
    });
  });

  it("rejects invalid CONNECT ports", () => {
    expect(() => parseConnectTarget("[::1]:99999")).toThrow("Invalid CONNECT target port");
    expect(() => parseConnectTarget("api.openai.com:1e3")).toThrow("Invalid CONNECT target port");
    expect(() => parseConnectTarget("api.openai.com:0x50")).toThrow("Invalid CONNECT target port");
  });
});

describe("startDebugProxyServer", () => {
  it("caps UTF-8 previews on character boundaries while forwarding full bodies", async () => {
    const settings = await makeSettings();
    const origin = await startLargeBodyOrigin(`${"r".repeat(8191)}😀tail`);
    const proxy = await startDebugProxyServer({ settings });
    const requestBody = `${"q".repeat(8191)}étail`;

    try {
      const responseBody = await postThroughProxy({
        body: requestBody,
        proxyUrl: proxy.proxyUrl,
        targetUrl: origin.url,
      });

      expect(origin.receivedRequestBody()).toBe(requestBody);
      expect(responseBody).toBe(origin.responseBody);
      const events = getDebugProxyCaptureStore().getSessionEvents(settings.sessionId, 10);
      const capturedRequest = events.find((event) => event.kind === "request");
      const capturedResponse = events.find((event) => event.kind === "response");
      expect(capturedRequest?.dataText).toBe("q".repeat(8191));
      expect(capturedResponse?.dataText).toBe("r".repeat(8191));
      expect(JSON.parse(String(capturedRequest?.metaJson))).toMatchObject({
        bodyBytes: Buffer.byteLength(requestBody),
        capturePreviewBytes: 8192,
        captureTruncated: true,
      });
      expect(JSON.parse(String(capturedResponse?.metaJson))).toMatchObject({
        bodyBytes: Buffer.byteLength(origin.responseBody),
        capturePreviewBytes: 8192,
        captureTruncated: true,
      });
    } finally {
      await proxy.stop();
      await origin.stop();
    }
  });

  it("returns a complete 502 and survives an upstream failure before response headers", async () => {
    const settings = await makeSettings();
    const origin = await startResponseErrorOrigin();
    const proxy = await startDebugProxyServer({ settings });

    try {
      const failed = await getThroughProxy(proxy.proxyUrl, `${origin.url}/before-headers`);
      expect(failed).toMatchObject({
        body: "Bad Gateway\n",
        complete: true,
        statusCode: 502,
      });

      const healthy = await getThroughProxy(proxy.proxyUrl, `${origin.url}/healthy`);
      expect(healthy).toMatchObject({ body: "ok", complete: true, statusCode: 200 });
      expect(getDebugProxyCaptureStore().getSessionEvents(settings.sessionId, 20)).toContainEqual(
        expect.objectContaining({ direction: "local", kind: "error" }),
      );
    } finally {
      await proxy.stop();
      await origin.stop();
    }
  });

  it("aborts a partial response after headers and survives the upstream stream error", async () => {
    const settings = await makeSettings();
    const origin = await startResponseErrorOrigin();
    const proxy = await startDebugProxyServer({ settings });

    try {
      const failed = await getThroughProxy(proxy.proxyUrl, `${origin.url}/after-headers`);
      expect(failed).toMatchObject({
        body: "partial",
        complete: false,
        statusCode: 200,
      });
      expect(failed.errorMessage).toBeDefined();

      const healthy = await getThroughProxy(proxy.proxyUrl, `${origin.url}/healthy`);
      expect(healthy).toMatchObject({ body: "ok", complete: true, statusCode: 200 });
      expect(getDebugProxyCaptureStore().getSessionEvents(settings.sessionId, 20)).toContainEqual(
        expect.objectContaining({ direction: "inbound", kind: "error" }),
      );
    } finally {
      await proxy.stop();
      await origin.stop();
    }
  });

  it("survives a mid-response client abort and still serves later requests", async () => {
    const settings = await makeSettings();
    const origin = await startStreamingOrigin();
    const proxy = await startDebugProxyServer({ settings });

    try {
      const proxyUrl = new URL(proxy.proxyUrl);
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          {
            host: proxyUrl.hostname,
            port: Number(proxyUrl.port),
            method: "GET",
            path: origin.url,
            headers: { connection: "close" },
          },
          (res) => {
            res.once("data", () => {
              // Abort after the first chunk so the proxy must cancel upstream
              // without an unhandled write-after-end crash.
              req.destroy();
              resolve();
            });
            res.on("error", () => {
              // expected when the client tears down mid-body
            });
          },
        );
        req.on("error", () => {
          // destroy can surface as a request error; still treat as success if
          // the subsequent healthy request works.
          resolve();
        });
        req.setTimeout(5_000, () => reject(new Error("client abort timed out")));
        req.end();
      });

      // Give the proxy a tick to finish cancel cleanup before the next request.
      await new Promise((r) => setTimeout(r, 50));

      const healthy = await getThroughProxy(proxy.proxyUrl, origin.healthyUrl);
      expect(healthy).toMatchObject({ body: "ok", complete: true, statusCode: 200 });
    } finally {
      await proxy.stop();
      await origin.stop();
    }
  });
});

describe("pipeUpstreamBodyToClient", () => {
  it("pauses the upstream source when write() applies backpressure and resumes on drain", () => {
    const upstream = new FakeUpstream();
    const downstream = new FakeDownstream();
    const chunks: string[] = [];
    const onEnd = vi.fn();
    const onUpstreamError = vi.fn();

    pipeUpstreamBodyToClient({
      upstreamRes: upstream,
      res: downstream,
      onChunk: (buffer) => {
        chunks.push(buffer.toString("utf8"));
      },
      onEnd,
      onUpstreamError,
    });

    downstream.nextWriteOk = false;
    upstream.emitData("a");
    expect(chunks).toEqual(["a"]);
    expect(upstream.paused).toBe(true);
    expect(downstream.written).toEqual(["a"]);

    downstream.nextWriteOk = true;
    downstream.emitDrain();
    expect(upstream.paused).toBe(false);

    upstream.emitData("b");
    upstream.emitEnd();
    expect(chunks).toEqual(["a", "b"]);
    expect(downstream.written).toEqual(["a", "b"]);
    expect(downstream.ended).toBe(true);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onUpstreamError).not.toHaveBeenCalled();
  });

  it("destroys the upstream source when the client leaves before end", () => {
    const upstream = new FakeUpstream();
    const downstream = new FakeDownstream();
    const onEnd = vi.fn();

    pipeUpstreamBodyToClient({
      upstreamRes: upstream,
      res: downstream,
      onChunk: () => {},
      onEnd,
      onUpstreamError: () => {},
    });

    upstream.emitData("partial");
    downstream.emitClientGone();
    expect(upstream.destroyed).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });
});

class FakeUpstream extends EventEmitter {
  destroyed = false;
  paused = false;

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitData(text: string): void {
    this.emit("data", Buffer.from(text));
  }

  emitEnd(): void {
    this.emit("end");
  }
}

class FakeDownstream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableFinished = false;
  ended = false;
  nextWriteOk = true;
  written: string[] = [];

  write(chunk: Buffer): boolean {
    this.written.push(chunk.toString("utf8"));
    return this.nextWriteOk;
  }

  end(): void {
    this.ended = true;
    this.writableEnded = true;
    this.writableFinished = true;
    this.emit("close");
  }

  emitDrain(): void {
    this.emit("drain");
  }

  emitClientGone(): void {
    this.destroyed = true;
    this.writableFinished = false;
    this.emit("close");
  }
}

async function startStreamingOrigin(): Promise<{
  healthyUrl: string;
  stop: () => Promise<void>;
  url: string;
}> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/healthy") {
      res.writeHead(200, {
        "content-length": 2,
        "content-type": "text/plain; charset=utf-8",
      });
      res.end("ok");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    let i = 0;
    const timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        clearInterval(timer);
        return;
      }
      res.write(`chunk-${i++}\n`);
      if (i > 200) {
        clearInterval(timer);
        res.end();
      }
    }, 5);
    res.on("close", () => {
      clearInterval(timer);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  return {
    healthyUrl: `${base}/healthy`,
    url: `${base}/stream`,
    stop: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
