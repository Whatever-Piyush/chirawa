import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { processImage, IMAGE_EDGE_PX } from '../image-pipeline';

// A small solid-colour PNG to feed the pipeline (10x20 so we can prove squaring).
async function samplePng(w = 10, h = 20): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 0, b: 0 } } })
    .png().toBuffer();
}

// Records what the pipeline tried to upload; returns a deterministic URL.
function makeUpload() {
  const calls: Array<{ folder: string; buffer: Buffer; mime: string; key: string | undefined }> = [];
  const upload = vi.fn(async (folder: 'shops' | 'products', buffer: Buffer, mime: string, key?: string) => {
    calls.push({ folder, buffer, mime, key });
    return `https://cdn.test/${folder}/${key}.webp`;
  });
  return { upload, calls };
}

// Minimal Response stub for the URL-fetch path.
function fetchReturning(body: Buffer | null, { status = 200, contentType = 'image/png', contentLength }: { status?: number; contentType?: string; contentLength?: number } = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : h.toLowerCase() === 'content-length' ? (contentLength != null ? String(contentLength) : null) : null) },
    arrayBuffer: async () => (body ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)),
  })) as unknown as typeof fetch;
}

describe('processImage', () => {
  it('normalizes a buffer to a square ~1200px WebP and re-hosts under its content hash', async () => {
    const { upload, calls } = makeUpload();
    const out = await processImage(
      { buffer: await samplePng(), source: 'manual', license: 'owned' },
      { upload },
    );

    expect(upload).toHaveBeenCalledTimes(1);
    expect(calls[0]!.folder).toBe('products');
    expect(calls[0]!.mime).toBe('image/webp');
    expect(calls[0]!.key).toBe(out.hash);          // key === content hash
    expect(out.url).toBe(`https://cdn.test/products/${out.hash}.webp`);
    expect(out).toMatchObject({ source: 'manual', license: 'owned', attribution: null });

    // The uploaded bytes really are a 1200x1200 WebP.
    const meta = await sharp(calls[0]!.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(IMAGE_EDGE_PX);
    expect(meta.height).toBe(IMAGE_EDGE_PX);
  });

  it('is idempotent: the same input yields the same hash/key (dedupes on re-run)', async () => {
    const { upload, calls } = makeUpload();
    const png = await samplePng();
    const a = await processImage({ buffer: png }, { upload });
    const b = await processImage({ buffer: png }, { upload });
    expect(a.hash).toBe(b.hash);
    expect(calls[0]!.key).toBe(calls[1]!.key);
  });

  it('fetches + re-hosts a URL (never hotlinks)', async () => {
    const { upload } = makeUpload();
    const out = await processImage(
      { url: 'https://images.example.com/maggi.png', source: 'distributor' },
      { upload, fetchImpl: fetchReturning(await samplePng()) },
    );
    expect(out.url).toContain('https://cdn.test/products/');
    expect(out.source).toBe('distributor');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-image content-type', async () => {
    const { upload } = makeUpload();
    await expect(processImage(
      { url: 'https://x.example.com/page.html' },
      { upload, fetchImpl: fetchReturning(Buffer.from('<html>'), { contentType: 'text/html' }) },
    )).rejects.toThrow(/not an image/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a failed fetch (non-2xx)', async () => {
    const { upload } = makeUpload();
    await expect(processImage(
      { url: 'https://x.example.com/missing.png' },
      { upload, fetchImpl: fetchReturning(null, { status: 404 }) },
    )).rejects.toThrow(/HTTP 404/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('blocks an internal/SSRF host without calling fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(processImage(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      { upload: makeUpload().upload, fetchImpl: fetchImpl as unknown as typeof fetch },
    )).rejects.toThrow(/not allowed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unprocessable/corrupt input', async () => {
    const { upload } = makeUpload();
    await expect(processImage({ buffer: Buffer.from('not an image at all') }, { upload }))
      .rejects.toThrow(/could not be processed/i);
    expect(upload).not.toHaveBeenCalled();
  });
});
