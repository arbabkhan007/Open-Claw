import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import {
  ManagedOutgoingImageResolverController,
  needsManagedOutgoingImageCoordinateReload,
} from "./managed-image-preview.ts";

describe("managed image previews", () => {
  it("requests transcript coordinates only for unresolved managed images", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Generated image" },
        {
          type: "image",
          url: "/api/chat/media/outgoing/agent%3Amain%3Amain/image-id/full",
        },
      ],
    };

    expect(needsManagedOutgoingImageCoordinateReload(message)).toBe(true);
    expect(needsManagedOutgoingImageCoordinateReload({ ...message, __openclaw: { seq: 7 } })).toBe(
      false,
    );
    expect(
      needsManagedOutgoingImageCoordinateReload({
        ...message,
        content: [{ type: "image", url: "https://example.test/image.png" }],
      }),
    ).toBe(false);
  });

  it("coalesces artifact listing across concurrent image downloads", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "artifacts.list") {
        await Promise.resolve();
        return {
          artifacts: [
            {
              id: "artifact-1",
              type: "image",
              title: "Generated image 1",
              messageSeq: 7,
              contentIndex: 1,
              download: { mode: "url" },
            },
            {
              id: "artifact-2",
              type: "image",
              title: "Generated image 2",
              messageSeq: 7,
              contentIndex: 2,
              download: { mode: "url" },
            },
          ],
        };
      }
      const artifactId = String(params.artifactId);
      return {
        artifact: {
          id: artifactId,
          type: "image",
          title: artifactId,
          mimeType: "image/png",
          download: { mode: "bytes" },
        },
        encoding: "base64",
        data: "cG5n",
      };
    });
    const client = { request } as unknown as GatewayBrowserClient;
    const scope = { client };
    const controller = new ManagedOutgoingImageResolverController<{ client: GatewayBrowserClient }>(
      (candidate) => candidate === scope,
      (candidate) => candidate.client,
    );
    controller.refresh(scope, true);
    const resolve = controller.current;
    expect(resolve).toBeDefined();

    const previews = await Promise.all(
      [1, 2].map((contentIndex) =>
        resolve!({
          source: `/api/chat/media/outgoing/agent%3Amain%3Amain/11111111-1111-4111-8111-11111111111${contentIndex}/full`,
          sessionKey: "agent:main:main",
          agentId: "main",
          messageSeq: 7,
          contentIndex,
        }),
      ),
    );

    expect(previews.map((preview) => preview?.type)).toEqual(["image/png", "image/png"]);
    expect(request.mock.calls.filter(([method]) => method === "artifacts.list")).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === "artifacts.download")).toHaveLength(
      2,
    );
  });
});
