import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertImageToJpegMock, detectMimeMock } = vi.hoisted(() => ({
  convertImageToJpegMock: vi.fn(),
  detectMimeMock: vi.fn(),
}));

vi.mock("@openclaw/media-core/mime", () => ({
  detectMime: detectMimeMock,
  normalizeMimeType: (value?: string | null) => value?.split(";", 1)[0]?.trim().toLowerCase(),
}));

vi.mock("./image-ops.js", () => ({
  convertImageToJpeg: convertImageToJpegMock,
}));

import { normalizeAnthropicInlineContentBlocks } from "./anthropic-inline-images.js";

describe("normalizeAnthropicInlineContentBlocks", () => {
  beforeEach(() => {
    convertImageToJpegMock.mockReset();
    convertImageToJpegMock.mockResolvedValue(Buffer.from("converted-jpeg"));
    detectMimeMock.mockReset();
  });

  it("converts detected unsupported bytes despite a supported declaration", async () => {
    detectMimeMock.mockResolvedValue("image/tiff");
    const tiffData = Buffer.from("tiff-bytes").toString("base64");

    await expect(
      normalizeAnthropicInlineContentBlocks([
        { type: "image", data: tiffData, mimeType: "image/jpeg" },
      ]),
    ).resolves.toEqual([
      {
        type: "image",
        data: Buffer.from("converted-jpeg").toString("base64"),
        mimeType: "image/jpeg",
      },
    ]);
    expect(convertImageToJpegMock).toHaveBeenCalledOnce();
  });

  it("uses a supported declaration when byte detection is inconclusive", async () => {
    detectMimeMock.mockResolvedValue(undefined);
    const opaqueData = Buffer.from("not-a-recognized-image-header").toString("base64");

    await expect(
      normalizeAnthropicInlineContentBlocks([
        { type: "image", data: opaqueData, mimeType: "image/png" },
      ]),
    ).resolves.toEqual([{ type: "image", data: opaqueData, mimeType: "image/png" }]);
    expect(convertImageToJpegMock).not.toHaveBeenCalled();
  });
});
