import * as qrcode from 'qrcode';
import { PNG } from 'pngjs';
import { bufferFromUpload, decodeImage, readQrFromImage } from './qr-image';
import { buildKhqrPayload, parseKhqrPayload } from './khqr';

const MERCHANT = {
  bakongAccountId: 'acme_micro@devb',
  merchantName: 'Acme Microfinance',
  merchantCity: 'Phnom Penh',
  merchantCategoryCode: '6012',
};

/**
 * The upload path, exercised against real image bytes rather than a mock.
 *
 * Generating a QR PNG and reading it back is the only way to know the decoder
 * chain (base64 → PNG → RGBA → jsQR) actually works; a stubbed decoder would
 * pass while the operator's screenshot silently failed.
 */
describe('QR image upload', () => {
  const payload = buildKhqrPayload(MERCHANT, {
    amount: 149,
    currency: 'USD',
    billNumber: 'REF9',
  });

  it('reads a KHQR back out of a generated PNG', async () => {
    const dataUri = await qrcode.toDataURL(payload, { width: 400, margin: 2 });
    const decoded = readQrFromImage(bufferFromUpload(dataUri));
    expect(decoded).toBe(payload);
  });

  it('survives the full upload → digest → re-mint round trip', async () => {
    const dataUri = await qrcode.toDataURL(payload, { width: 400, margin: 2 });
    const parsed = parseKhqrPayload(readQrFromImage(bufferFromUpload(dataUri)));
    expect(parsed.bakongAccountId).toBe('acme_micro@devb');
    expect(parsed.merchantName).toBe('Acme Microfinance');
  });

  it('accepts raw base64 without a data: prefix', async () => {
    const dataUri = await qrcode.toDataURL(payload, { width: 400, margin: 2 });
    const rawBase64 = dataUri.slice(dataUri.indexOf(',') + 1);
    expect(readQrFromImage(bufferFromUpload(rawBase64))).toBe(payload);
  });

  it('decodes PNG dimensions correctly', async () => {
    const dataUri = await qrcode.toDataURL(payload, { width: 200, margin: 0 });
    const img = decodeImage(bufferFromUpload(dataUri));
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBe(img.width);
    // RGBA — 4 bytes per pixel.
    expect(img.data.length).toBe(img.width * img.height * 4);
  });

  describe('rejections', () => {
    it('rejects an empty upload', () => {
      expect(() => bufferFromUpload('')).toThrow(/empty/i);
    });

    it('rejects a non-image payload', () => {
      const notAnImage = Buffer.from(
        'this is plain text, not a picture',
      ).toString('base64');
      expect(() => readQrFromImage(bufferFromUpload(notAnImage))).toThrow(
        /Unsupported image format/i,
      );
    });

    it('rejects an image containing no QR code', () => {
      // A 32x32 all-white PNG, valid but empty of any code.
      const png = new PNG({ width: 32, height: 32 });
      png.data.fill(0xff);
      const buf = PNG.sync.write(png);
      expect(() => readQrFromImage(buf)).toThrow(/No QR code found/i);
    });

    it('rejects an oversized upload before decoding it', () => {
      const huge = Buffer.alloc(9 * 1024 * 1024).toString('base64');
      expect(() => bufferFromUpload(huge)).toThrow(/too large/i);
    });
  });
});
