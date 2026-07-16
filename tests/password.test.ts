import { describe, it, expect } from 'vitest'
import {
  validatePassword,
  hashPassword,
  verifyPassword,
  generateTempPassword,
} from '@/lib/auth/password'

describe('validatePassword', () => {
  it('rejects passwords under 8 characters', () => {
    expect(validatePassword('Ab1')).toMatch(/at least 8/)
  })
  it('rejects passwords with no letter', () => {
    expect(validatePassword('12345678')).toMatch(/letter/)
  })
  it('rejects passwords with no number', () => {
    expect(validatePassword('abcdefgh')).toMatch(/number/)
  })
  it('accepts a valid password', () => {
    expect(validatePassword('Abcd1234')).toBeNull()
  })
})

describe('generateTempPassword (server, CSPRNG)', () => {
  it('always produces a password that satisfies the password rules', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword()
      expect(pw.length).toBeGreaterThanOrEqual(8)
      expect(validatePassword(pw)).toBeNull()
    }
  })
  it('avoids ambiguous characters (0/O, 1/l/I)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/)
    }
  })
  it('is effectively non-repeating across many generations', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateTempPassword()))
    // With a CSPRNG over a 10-char alphanumeric space, collisions are astronomically unlikely.
    expect(set.size).toBe(500)
  })
})

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password (bcrypt)', async () => {
    const hash = await hashPassword('Abcd1234')
    expect(hash).not.toBe('Abcd1234')
    expect(await verifyPassword('Abcd1234', hash)).toBe(true)
    expect(await verifyPassword('WrongPass9', hash)).toBe(false)
  })
})
