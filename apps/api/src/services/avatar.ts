export const AVATAR_MAX_BYTES = 512 * 1024;
export type AvatarMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Column exposing when the photo last changed, as a cache-busting version for
 * the image URL. It is null when the account has no photo.
 */
export const avatarVersionColumn = `CASE WHEN avatar_updated_at IS NULL THEN NULL
  ELSE (extract(epoch FROM avatar_updated_at)*1000)::bigint::text END AS "avatarVersion"`;

const signatures: Record<AvatarMime, (bytes: Buffer) => boolean> = {
  'image/jpeg': (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
};

export class AvatarError extends Error {
  constructor(readonly code: 'AVATAR_INVALID' | 'AVATAR_TOO_LARGE') {
    super(code);
  }
}

/**
 * Decodes a data URL and checks that the bytes really are the declared
 * raster format, so a renamed file of another type is refused.
 */
export function parseAvatarDataUrl(value: string): { mime: AvatarMime; bytes: Buffer } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new AvatarError('AVATAR_INVALID');
  const mime = match[1] as AvatarMime;
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError('AVATAR_TOO_LARGE');
  if (!signatures[mime](bytes)) throw new AvatarError('AVATAR_INVALID');
  return { mime, bytes };
}
