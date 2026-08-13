import { put, issueSignedToken, presignUrl } from '@vercel/blob'

/**
 * Vercel Blob access for delivery-note attachments. The store is PRIVATE: uploaded blobs require
 * a token to read, so a raw blob URL is never viewable directly and must never be rendered as a
 * plain `src`. Reads go through a short-lived signed URL minted on demand (see the view route).
 * No filesystem access anywhere — all I/O is over the Blob HTTP API.
 */

export const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB

/** Read the Blob read-write token from the environment, failing loudly with a clear message. */
export function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token || token.trim() === '') {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set — configure the Vercel Blob store token before uploading or viewing attachments.')
  }
  return token
}

/** Upload one delivery attachment to the PRIVATE store; returns the stored pathname. */
export async function uploadDeliveryAttachment(
  deliveryId: string,
  body: ArrayBuffer | Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const token = getBlobToken()
  const ext = contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1] ?? 'bin'
  const result = await put(`deliveries/${deliveryId}/note.${ext}`, body as Buffer, {
    access: 'private',
    token,
    contentType,
    addRandomSuffix: true, // never overwrite/collide — old blobs are retained this stage
  })
  return result.pathname
}

/** Mint a short-lived (default ~1h; we cap tighter) signed GET URL for a private attachment. */
export async function signedAttachmentUrl(pathname: string): Promise<string> {
  const token = getBlobToken()
  const validUntil = Date.now() + 5 * 60 * 1000 // 5 minutes
  const signedToken = await issueSignedToken({ token, pathname, operations: ['get'], validUntil })
  const { presignedUrl } = await presignUrl(signedToken, { operation: 'get', pathname, access: 'private', validUntil })
  return presignedUrl
}
