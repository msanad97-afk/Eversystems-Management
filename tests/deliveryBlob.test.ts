import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Vercel Blob SDK so no network/token is needed; we assert what the SDK is called with.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}))

import { put, issueSignedToken, presignUrl } from '@vercel/blob'
import { uploadDeliveryAttachment, signedAttachmentUrl } from '@/lib/deliveries/blob.server'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
  // put() with addRandomSuffix returns the FINAL (suffixed) pathname — that is what we persist.
  vi.mocked(put).mockImplementation(async (pathname: string) => ({ pathname: `${pathname}-abc123`, url: `https://blob.example/${pathname}-abc123` }) as never)
  vi.mocked(issueSignedToken).mockResolvedValue({ delegationToken: 'dt', clientSigningToken: 'cst', validUntil: Date.now() + 60_000 } as never)
  vi.mocked(presignUrl).mockResolvedValue({ presignedUrl: 'https://signed.example/note?sig=xyz' } as never)
})

describe('signed attachment URL uses the exact pathname that upload stored', () => {
  it('the pathname passed to presignUrl (and issueSignedToken) equals what uploadDeliveryAttachment returned', async () => {
    const stored = await uploadDeliveryAttachment('del-1', Buffer.from('pdf-bytes'), 'application/pdf')
    // We persist the suffixed pathname the SDK returned, not the raw requested one, and not a URL.
    expect(stored).toBe('deliveries/del-1/note.pdf-abc123')

    const signed = await signedAttachmentUrl(stored)
    expect(signed).toBe('https://signed.example/note?sig=xyz')

    // The signing inputs must be the SAME pathname — no url-vs-pathname drift.
    expect(vi.mocked(issueSignedToken).mock.calls[0]![0]).toMatchObject({ pathname: stored, operations: ['get'] })
    expect(vi.mocked(presignUrl).mock.calls[0]![1]).toMatchObject({ operation: 'get', pathname: stored, access: 'private' })
  })
})
