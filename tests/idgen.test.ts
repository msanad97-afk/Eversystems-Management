import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { nextCode } from '@/lib/idgen'

// Integration test against the local Postgres (the app requires it to run anyway).
const prisma = new PrismaClient()
const usedScopes: string[] = []

function scope(label: string): string {
  const s = `test:${label}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`
  usedScopes.push(s)
  return s
}

afterAll(async () => {
  if (usedScopes.length > 0) {
    await prisma.reportCounter.deleteMany({ where: { scope: { in: usedScopes } } })
  }
  await prisma.$disconnect()
})

describe('nextCode', () => {
  it('formats and zero-pads the first value', async () => {
    const s = scope('fmt')
    const code = await prisma.$transaction((tx) => nextCode(tx, s, 'USR', 5))
    expect(code).toBe('USR-00001')
  })

  it('honours a different prefix and pad width', async () => {
    const s = scope('pad')
    const code = await prisma.$transaction((tx) => nextCode(tx, s, 'DR-2026', 4))
    expect(code).toBe('DR-2026-0001')
  })

  it('increments sequentially on repeated calls', async () => {
    const s = scope('seq')
    const a = await prisma.$transaction((tx) => nextCode(tx, s, 'PRJ', 3))
    const b = await prisma.$transaction((tx) => nextCode(tx, s, 'PRJ', 3))
    expect(a).toBe('PRJ-001')
    expect(b).toBe('PRJ-002')
  })

  it('produces unique, gap-free codes under concurrency (Postgres row lock)', async () => {
    const s = scope('conc')
    const N = 10
    const results = await Promise.all(
      Array.from({ length: N }, () => prisma.$transaction((tx) => nextCode(tx, s, 'PRJ', 3))),
    )
    const nums = results.map((r) => Number(r.split('-').pop())).sort((a, b) => a - b)
    expect(new Set(results).size).toBe(N)
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
