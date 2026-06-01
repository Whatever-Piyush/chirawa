import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { ExternalServiceError, ValidationError } from '../shared/errors/app-errors';

// ─── Cloudflare R2 (S3-compatible) image storage ──────────────────────────────
// Used by the admin image-upload endpoint to store shop/product photos.
// Configure via R2_* env vars; with placeholder creds the service refuses to
// upload (so dev fails loudly rather than silently writing nowhere).

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const ALLOWED_IMAGE_MIME = Object.keys(MIME_EXT);

export function isR2Configured(): boolean {
  return (
    env.R2_ACCOUNT_ID !== 'placeholder' &&
    env.R2_ACCESS_KEY_ID !== 'placeholder' &&
    env.R2_SECRET_ACCESS_KEY !== 'placeholder'
  );
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

/**
 * Upload an image buffer to R2 under `shops/` or `products/` and return its
 * public URL. Validates mime type; callers must enforce the size limit
 * (the multipart plugin rejects oversized files before we reach here).
 */
export async function uploadImage(
  folder: 'shops' | 'products',
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!isR2Configured()) {
    throw new ExternalServiceError('R2', 'Image storage is not configured (set R2_* env vars)');
  }
  const ext = MIME_EXT[mimeType];
  if (!ext) {
    throw new ValidationError(`Unsupported image type: ${mimeType}. Use jpg, png or webp.`);
  }

  const key = `${folder}/${randomUUID()}.${ext}`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const base = env.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${key}`;
}
