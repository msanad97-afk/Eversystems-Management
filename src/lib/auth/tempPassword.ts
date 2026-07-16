/**
 * UI-CONVENIENCE ONLY. Pure (no-crypto-dependency) temporary-password generator,
 * safe to import into client components for the "Generate" button. It uses
 * Math.random and MUST NOT be treated as a source of security. The server always
 * re-generates the stored temp password with a CSPRNG (see generateTempPassword in
 * password.ts) and never trusts or reuses this value as randomness — any string the
 * admin submits is validated and hashed like any other password.
 */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const all = upper + lower + digits
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]

  const chars = [pick(upper), pick(lower), pick(digits), pick(digits)]
  for (let i = 0; i < 6; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
