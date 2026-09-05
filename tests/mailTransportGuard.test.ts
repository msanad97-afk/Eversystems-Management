import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The REAL transport (not mocked) must refuse to open a connection under test. We mock nodemailer
// only to prove it is never touched — the guard short-circuits before getTransport() runs.
const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }))

import { sendMail } from '@/lib/email/transport'

const KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  // Live-looking SMTP credentials present in the environment — exactly the 01/09 condition.
  process.env.SMTP_HOST = 'smtp-relay.brevo.com'
  process.env.SMTP_USER = 'b235e2001@smtp-brevo.com'
  process.env.SMTP_PASSWORD = 'live-password'
  createTransport.mockReset().mockReturnValue({ sendMail: vi.fn() })
})
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('mail transport guard', () => {
  it('does not open a nodemailer transport under VITEST even with SMTP_HOST/USER/PASSWORD set', async () => {
    expect(process.env.VITEST).toBeDefined() // vitest sets this for every run
    await expect(sendMail({ to: 'x@e.local', subject: 'Guard test', html: '<p>hi</p>', text: 'hi' })).resolves.toBeUndefined()
    expect(createTransport).not.toHaveBeenCalled() // never reached the transport — nothing sent
  })

  it('still refuses when only NODE_ENV=test flags the run (VITEST unset)', async () => {
    const vitest = process.env.VITEST
    delete process.env.VITEST // fall back to the NODE_ENV path
    try {
      expect(process.env.NODE_ENV).toBe('test') // vitest sets NODE_ENV=test for the run
      await sendMail({ to: 'x@e.local', subject: 'Guard test', html: '<p>hi</p>' })
      expect(createTransport).not.toHaveBeenCalled()
    } finally {
      if (vitest === undefined) delete process.env.VITEST; else process.env.VITEST = vitest
    }
  })
})
