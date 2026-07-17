import { canonicalizeBase64 } from "@openclaw/media-core/base64";
import { detectMime, normalizeMimeType } from "@openclaw/media-core/mime";
import { convertImageToJpeg } from "./image-ops.js";

const ANTHROPIC_SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type AnthropicSupportedImageMime = (typeof ANTHROPIC_SUPPORTED_IMAGE_MIMES)[number];

type AnthropicInlineTextBlock = { type: "text"; text: string };
type AnthropicInlineImageBlock = { type: "image"; data: string; mimeType: string };
type AnthropicInlineBlock = AnthropicInlineTextBlock | AnthropicInlineImageBlock;
type NormalizedAnthropicInlineImageBlock = Omit<AnthropicInlineImageBlock, "mimeType"> & {
  mimeType: AnthropicSupportedImageMime;
};
type NormalizedAnthropicInlineBlock =
  | AnthropicInlineTextBlock
  | NormalizedAnthropicInlineImageBlock;

const ANTHROPIC_SUPPORTED_IMAGE_MIME_SET = new Set<string>(ANTHROPIC_SUPPORTED_IMAGE_MIMES);

function isAnthropicSupportedImageMime(
  value: string | undefined,
): value is AnthropicSupportedImageMime {
  return typeof value === "string" && ANTHROPIC_SUPPORTED_IMAGE_MIME_SET.has(value);
}

async function normalizeAnthropicInlineImage(block: AnthropicInlineImageBlock): Promise<{
  data: string;
  mimeType: AnthropicSupportedImageMime;
}> {
  const canonicalData = canonicalizeBase64(block.data) ?? block.data.trim();
  const buffer = Buffer.from(canonicalData, "base64");
  const declaredMime = normalizeMimeType(block.mimeType);
  const detectedMime = normalizeMimeType(await detectMime({ buffer }));
  if (isAnthropicSupportedImageMime(detectedMime)) {
    return { data: canonicalData, mimeType: detectedMime };
  }
  if (!detectedMime && isAnthropicSupportedImageMime(declaredMime)) {
    return { data: canonicalData, mimeType: declaredMime };
  }

  const normalizedBuffer = await convertImageToJpeg(buffer);
  return {
    data: normalizedBuffer.toString("base64"),
    mimeType: "image/jpeg",
  };
}

export async function normalizeAnthropicInlineContentBlocks(
  content: readonly AnthropicInlineBlock[],
): Promise<NormalizedAnthropicInlineBlock[]> {
  return await Promise.all(
    content.map(async (block) => {
      if (block.type !== "image") {
        return block;
      }
      return {
        ...block,
        ...(await normalizeAnthropicInlineImage(block)),
      };
    }),
  );
}
