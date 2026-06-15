/**
 * Backend-agnostic image compression.
 *
 * Image processing is used to shrink Discord image attachments before sending
 * them to the vision model. Smaller images = fewer tokens
 * Tries to use bun first, then sharp, then jsut the base image. 
 */

import { log } from "./logger.js";

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 80;

export interface CompressedImage {
  base64DataUrl: string;
  originalSize: number;
  compressedSize: number;
}

export async function compressImage(
  originalBuffer: Buffer,
  _contentType: string,
): Promise<CompressedImage | null> {
  // Bun.Image
  if (typeof Bun !== "undefined" && typeof Bun.Image === "function") {
    try {
      const img = new Bun.Image(originalBuffer);
      const out = await img
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside" })
        .jpeg({ quality: JPEG_QUALITY })
        .buffer();

      const compressedSize = out.length;
      const originalSize = originalBuffer.length;
      const base64 = out.toString("base64");
      return { base64DataUrl: `data:image/jpeg;base64,${base64}`, originalSize, compressedSize };
    } catch (error) {
      log.warn(`Bun.Image compression failed, trying fallback: ${error}`);
    }
  }

  // sharp
  try {
    const sharp = (await import("sharp")).default;
    const compressedBuffer = await sharp(originalBuffer)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    const compressedSize = compressedBuffer.length;
    const originalSize = originalBuffer.length;
    const base64 = compressedBuffer.toString("base64");
    return { base64DataUrl: `data:image/jpeg;base64,${base64}`, originalSize, compressedSize };
  } catch (error) {
    log.debug(`Image backend unavailable or failed: ${error}`);
    return null;
  }
}

export function encodeUncompressed(buffer: Buffer, contentType: string): string {
  const base64 = buffer.toString("base64");
  const mime = contentType || "application/octet-stream";
  return `data:${mime};base64,${base64}`;
}
