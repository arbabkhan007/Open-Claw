// Discord tests cover send.webhook timeout behavior.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCORD_WEBHOOK_TIMEOUT_MS, sendWebhookMessageDiscord } from "./send.webhook.js";

const cfg = {
  channels: {
    discord: {
      token: "Bot test-token",
    },
  },
} as OpenClawConfig;

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

describe("sendWebhookMessageDiscord timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports the Discord REST outbound timeout budget", () => {
    expect(DISCORD_WEBHOOK_TIMEOUT_MS).toBe(15_000);
  });

  it("aborts webhook response body reads that exceed the request deadline", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          observedSignal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Discord webhook timed out", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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

  it("times out a loopback webhook that never returns headers", async () => {
    const fixture = await listenNeverRespondServer();
    const timeoutMs = 250;
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = typeof input === "string" ? input : input.toString();
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
