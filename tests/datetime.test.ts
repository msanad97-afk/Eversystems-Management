import { describe, it, expect } from 'vitest'
import {
  APP_TIMEZONE,
  civilDateString,
  civilMidnightUtc,
  startOfAppDay,
  todayCivilString,
  diffInDays,
  addDays,
} from '@/lib/datetime'

describe('APP_TIMEZONE', () => {
  it('is Asia/Bahrain', () => {
    expect(APP_TIMEZONE).toBe('Asia/Bahrain')
  })
})

describe('civilDateString — Bahrain is UTC+3', () => {
  it('rolls to the next civil day at local midnight (21:00 UTC)', () => {
    // 20:59:59Z = 23:59:59 Bahrain (still the 14th)
    expect(civilDateString(new Date('2026-07-14T20:59:59Z'))).toBe('2026-07-14')
    // 21:00:00Z = 00:00 Bahrain (now the 15th)
    expect(civilDateString(new Date('2026-07-14T21:00:00Z'))).toBe('2026-07-15')
  })

  it('the 00:00–03:00 local window is on the correct (next) civil day', () => {
    // 22:30Z = 01:30 Bahrain on the 15th — the exact window the bug affected.
    expect(civilDateString(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15')
    // A UTC-naive slice would wrongly say 2026-07-14 here:
    expect(new Date('2026-07-14T22:30:00Z').toISOString().slice(0, 10)).toBe('2026-07-14')
  })

  it('daytime instants stay on the same civil day', () => {
    expect(civilDateString(new Date('2026-07-14T10:00:00Z'))).toBe('2026-07-14')
  })
})

describe('startOfAppDay / civilMidnightUtc', () => {
  it('startOfAppDay returns UTC midnight of the Bahrain civil date', () => {
    expect(startOfAppDay(new Date('2026-07-14T22:30:00Z')).toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })
  it('civilMidnightUtc parses a civil date string to UTC midnight', () => {
    expect(civilMidnightUtc('2026-07-15').toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })
  it('todayCivilString matches civilDateString', () => {
    const now = new Date('2026-07-14T22:30:00Z')
    expect(todayCivilString(now)).toBe(civilDateString(now))
  })
})

describe('diffInDays / addDays', () => {
  it('counts whole civil days', () => {
    expect(diffInDays(civilMidnightUtc('2026-07-15'), civilMidnightUtc('2026-07-08'))).toBe(7)
  })
  it('adds days', () => {
    expect(addDays(civilMidnightUtc('2026-07-15'), -14).toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})
