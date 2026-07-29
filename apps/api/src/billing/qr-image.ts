import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

/**
 * Decode a QR code out of an uploaded image.
 *
 * Deliberately narrow: PNG and JPEG only, decoded in-process with pure-JS
 * libraries. No `sharp`/ImageMagick — a native image pipeline parsing operator
 * uploads is a much larger attack surface than this feature justifies, and a
 * screenshot from the Bakong app is always one of these two formats.
 */

/** 8 MB decoded ceiling — a phone screenshot is far below this. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Guard against decompression bombs before allocating a pixel buffer. */
const MAX_PIXELS = 40_000_000;

export type RgbaImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/** Strip a `data:image/png;base64,...` wrapper if present, then decode. */
export function bufferFromUpload(input: string): Buffer {
  const base64 =
    input.includes(',') && input.trim().startsWith('data:')
      ? input.slice(input.indexOf(',') + 1)
      : input;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new Error('The uploaded image is empty.');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Image is too large. Upload a screenshot under 8 MB.');
  }
  return buffer;
}

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
}

function isJpeg(buf: Buffer): boolean {
  return (
    buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

export function decodeImage(buffer: Buffer): RgbaImage {
  if (isPng(buffer)) {
    const png = PNG.sync.read(buffer);
    if (png.width * png.height > MAX_PIXELS) {
      throw new Error('Image resolution is too large.');
    }
    return {
      data: new Uint8ClampedArray(png.data),
      width: png.width,
      height: png.height,
    };
  }

  if (isJpeg(buffer)) {
    const img = jpeg.decode(buffer, {
      useTArray: true,
      maxMemoryUsageInMB: 64,
    });
    if (img.width * img.height > MAX_PIXELS) {
      throw new Error('Image resolution is too large.');
    }
    return {
      data: new Uint8ClampedArray(img.data),
      width: img.width,
      height: img.height,
    };
  }

  throw new Error('Unsupported image format. Upload a PNG or JPEG screenshot.');
}

/**
 * Extract the QR payload from an image.
 *
 * Retries once with inverted binarisation: dark-mode screenshots produce a
 * light-on-dark QR that the default "attemptBoth" pass still sometimes misses.
 */
export function readQrFromImage(buffer: Buffer): string {
  const { data, width, height } = decodeImage(buffer);

  for (const inversionAttempts of ['attemptBoth', 'invertFirst'] as const) {
    const result = jsQR(data, width, height, { inversionAttempts });
    if (result?.data) return result.data;
  }

  throw new Error(
    'No QR code found in that image. Crop the screenshot tightly around the ' +
      'QR and try again, or paste the KHQR payload text instead.',
  );
}
