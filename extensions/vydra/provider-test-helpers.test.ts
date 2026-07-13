// Vydra tests cover provider test helpers plugin behavior.
import { once } from "node:events";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import * as providerAuth from "openclaw/plugin-sdk/provider-auth-runtime";
import { vi } from "vitest";

type RecordedVydraRequest = {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
};

type LocalVydraRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  request: RecordedVydraRequest,
) => void | Promise<void>;

export function stubVydraApiKey(): void {
  vi.spyOn(providerAuth, "resolveApiKeyForProvider").mockResolvedValue({
    apiKey: "vydra-test-key",
    source: "env",
    mode: "api-key",
  });
}

export function jsonResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function binaryResponse(data: string, contentType: string): Response {
  return new Response(Buffer.from(data), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

export function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export async function startLocalVydraHttpServer(handler: LocalVydraRouteHandler): Promise<{
  baseUrl: string;
  requests: RecordedVydraRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedVydraRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const request = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      try {
        await handler(req, res, request);
      } catch (error) {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Local Vydra proof server did not expose a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    requests,
    close: () => closeServer(server),
  };
}

export function writeJsonResponse(res: ServerResponse, payload: Record<string, unknown>): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function writeBinaryResponse(res: ServerResponse, data: string, contentType: string): void {
  res.writeHead(200, { "Content-Type": contentType });
  res.end(Buffer.from(data));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
