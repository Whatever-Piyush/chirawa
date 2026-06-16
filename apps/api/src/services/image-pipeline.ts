import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { uploadImage, MAX_IMAGE_BYTES } from './r2.service';
import { ValidationError } from '../shared/errors/app-errors';

// ─── Image normalization pipeline (Catalog Engine Phase 1, ₹0) ────────────────
// Every image entry point (admin upload, CSV image_url, future OFF enrichment)
// goes through here so the catalog looks uniform and nothing is hotlinked:
//
//   fetch/validate → sharp(square pad on white, ~1200px WebP, strip EXIF) →
//   content-hash the output → uploadImage('products', …) under that hash.
//
// The content hash is the R2 key, so re-processing the same image overwrites the
// same object instead of piling up duplicates (idempotent re-runs). `rembg`
// background removal is intentionally NOT here — OFF/distributor pack-shots are
// already white-ish; it's a post-launch polish step (see inventory.md).

// Target spec from inventory.md: square 1:1, white bg, ~1200px, WebP.
export const IMAGE_EDGE_PX = 1200;
const WEBP_QUALITY = 82;
// Decompression-bomb guard: refuse absurdly large pixel dimensions even if the
// byte size is small. ~40 MP comfortably covers any real product photo.
const MAX_INPUT_PIXELS = 40_000_000;
const WHITE = { r: 255, g: 255, b: 255 } as const;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_UA = 'Bringly/1.0 (catalog image fetch)';

export interface ImageProvenance {
  source?: string | null;      // 'open_food_facts' | 'distributor' | 'manual'
  license?: string | null;     // 'CC-BY-SA' | 'owned'
  attribution?: string | null; // e.g. the OFF product URL, for the credits page
}

export interface ProcessedImage extends ImageProvenance {
  url: string;  // public R2 URL of the normalized WebP
  hash: string; // sha256 of the normalized bytes — also the R2 key basename
}

export type ImageInput = ({ buffer: Buffer } | { url: string }) & ImageProvenance;

// Injectable so unit tests can stub the network without mocking modules.
export interface ProcessDeps {
  upload?: typeof uploadImage;
  fetchImpl?: typeof fetch;
}

// Block obvious internal/link-local targets — cheap SSRF insurance for the
// CSV-supplied URL path. Not a full allowlist; loud failure beats a silent hit
// on an internal host.
function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  return (
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||                       // link-local / cloud metadata
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)          // 172.16.0.0–172.31.255.255
  );
}

async function fetchToBuffer(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ValidationError(`Invalid image URL: ${url}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('Image URL must be http(s)');
  }
  if (isDisallowedHost(parsed.hostname)) {
    throw new ValidationError('Image URL host is not allowed');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': FETCH_UA },
    });
    if (!res.ok) throw new ValidationError(`Image fetch failed (HTTP ${res.status})`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !ct.toLowerCase().startsWith('image/')) {
      throw new ValidationError(`URL is not an image (content-type: ${ct})`);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared && declared > MAX_IMAGE_BYTES) throw new ValidationError('Image too large (max 5MB)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError('Image too large (max 5MB)');
    if (buf.length === 0) throw new ValidationError('Fetched an empty image');
    return buf;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : (err instanceof Error ? err.message : 'failed');
    throw new ValidationError(`Image fetch ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize one image (from a buffer or a URL) to a square ~1200px white-padded
 * WebP, re-host it to R2, and return its public URL + content hash + provenance.
 * Throws ValidationError on bad/oversized/non-image input. Never hotlinks.
 */
export async function processImage(input: ImageInput, deps: ProcessDeps = {}): Promise<ProcessedImage> {
  const upload = deps.upload ?? uploadImage;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const raw = 'buffer' in input ? input.buffer : await fetchToBuffer(input.url, fetchImpl);
  if (raw.length > MAX_IMAGE_BYTES) throw new ValidationError('Image too large (max 5MB)');

  let webp: Buffer;
  try {
    webp = await sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()                                   // bake in EXIF orientation before metadata is stripped
      .flatten({ background: WHITE })             // composite any transparency onto white
      .resize(IMAGE_EDGE_PX, IMAGE_EDGE_PX, { fit: 'contain', background: WHITE })
      .webp({ quality: WEBP_QUALITY })            // toBuffer() strips all metadata (EXIF/ICC/payloads) by default
      .toBuffer();
  } catch (err) {
    throw new ValidationError(`Image could not be processed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  const hash = createHash('sha256').update(webp).digest('hex').slice(0, 32);
  const url = await upload('products', webp, 'image/webp', hash);

  return {
    url,
    hash,
    source: input.source ?? null,
    license: input.license ?? null,
    attribution: input.attribution ?? null,
  };
}
