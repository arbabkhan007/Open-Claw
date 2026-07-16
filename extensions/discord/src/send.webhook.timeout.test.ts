// Discord tests cover send.webhook timeout behavior.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordError } from "./internal/rest-errors.js";
import { DISCORD_REST_TIMEOUT_MS } from "./proxy-request-client.js";
import { sendWebhookMessageDiscord } from "./send.webhook.js";

const cfg = {
  channels: {
    discord: {
      token: "Bot test-token",
    },
  },
} as OpenClawConfig;

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<"pending" | "settled"> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  return settled ? "settled" : "pending";
}

async function listenNeverRespondServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requestCount: () => number;
}> {
  let requests = 0;
  const server = http.createServer((_req, _res) => {
    requests += 1;
    // Deliberately never write headers or end the response.
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function stalledBodyResponse(params: {
  status: number;
  signal?: AbortSignal;
  headers?: HeadersInit;
}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      params.signal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("Discord webhook timed out", "AbortError")),
        { once: true },
      );
    },
  });
  return new Response(body, {
    status: params.status,
    headers: params.headers ?? { "content-type": "application/json" },
  });
}

describe("sendWebhookMessageDiscord timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the Discord REST outbound timeout budget by default", () => {
    // Webhook send reuses DISCORD_REST_TIMEOUT_MS as its private default.
    expect(DISCORD_REST_TIMEOUT_MS).toBe(15_000);
  });

  it("keeps a never-responding webhook pending without a request signal (negative control)", async () => {
    const fixture = await listenNeverRespondServer();
    const hangMs = 200;
    try {
      const pending = fetch(`${fixture.baseUrl}/api/v10/webhooks/123/abc?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });
      expect(await settleWithin(pending, hangMs)).toBe("pending");
      expect(fixture.requestCount()).toBe(1);
      // Abort the orphan so the suite can exit cleanly.
      void pending.then(
        (response) => response.body?.cancel().catch(() => undefined),
        () => undefined,
      );
    } finally {
      await fixture.close();
    }
  });

  it("aborts webhook response body reads that exceed the request deadline", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      return stalledBodyResponse({ status: 200, signal: observedSignal });
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(fetcher);

    const sendPromise = sendWebhookMessageDiscord("hello", {
      cfg,
      webhookId: "123",
      webhookToken: "abc",
      wait: true,
      timeoutMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(observedSignal?.aborted).toBe(false);
    const rejection = expect(sendPromise).rejects.toThrow(/timed out|abort/i);

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(observedSignal?.aborted).toBe(true);
  });

  it("does not convert a stalled error-body deadline into DiscordError", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      return stalledBodyResponse({ status: 500, signal: observedSignal });
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(fetcher);

    let caught: unknown;
    const sendPromise = sendWebhookMessageDiscord("hello", {
      cfg,
      webhookId: "123",
      webhookToken: "abc",
      wait: true,
      timeoutMs: 5_000,
    }).then(
      () => {
        throw new Error("expected webhook send to reject on deadline");
      },
      (error: unknown) => {
        caught = error;
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await sendPromise;

    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(DiscordError);
    expect(String(caught)).toMatch(/timed out|abort/i);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("times out a loopback webhook that never returns headers", async () => {
    const fixture = await listenNeverRespondServer();
    const timeoutMs = 250;
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const rewritten = target.replace("https://discord.com", fixture.baseUrl);
      return await originalFetch(rewritten, init);
    });

    const startedAt = Date.now();
    await expect(
      sendWebhookMessageDiscord("hello", {
        cfg,
        webhookId: "123",
        webhookToken: "abc",
        wait: true,
        timeoutMs,
      }),
    ).rejects.toThrow(/timed out|abort|aborted/i);
    const elapsedMs = Date.now() - startedAt;

    expect(fixture.requestCount()).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(elapsedMs).toBeLessThan(timeoutMs + 2_000);

    await fixture.close();
  });
});
