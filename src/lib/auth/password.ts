import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'

const BCRYPT_COST = 12

/**
 * Password rules (spec: "same password rules" as PMIS; concrete values chosen here
 * and documented in the Phase 1 report):
 *   - at least 8 characters
 *   - at least one letter and one number
 */
export const PASSWORD_MIN_LENGTH = 8

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (!/[A-Za-z]/.test(password)) {
    return 'Password must contain at least one letter.'
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number.'
  }
  return null
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Server-side temporary-password generator. Uses a cryptographically secure RNG
 * (crypto.randomInt) — the server never trusts the client-side generator in
 * tempPassword.ts, which exists only for UI convenience. Avoids ambiguous
 * characters (0/O, 1/l/I) and guarantees at least one letter and one digit so the
 * result always satisfies validatePassword().
 */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const all = upper + lower + digits
  const pick = (set: string) => set[randomInt(set.length)]!

  const chars = [pick(upper), pick(lower), pick(digits), pick(digits)]
  for (let i = 0; i < 6; i++) chars.push(pick(all))
  // Fisher–Yates shuffle with the CSPRNG so guaranteed-class chars aren't positional.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
