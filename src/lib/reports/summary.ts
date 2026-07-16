/**
 * Report list rollups. Manpower and materials now hang off each activity, so the
 * per-report totals (workers · man-hours · materials count) are summed across all of
 * a report's activities. One place so every list view stays consistent.
 */

/** Prisma select for a report's activities sufficient to roll up totals. */
export const activityRollupSelect = {
  select: {
    manpower: { select: { headcount: true, hours: true } },
    materials: { select: { id: true } },
  },
} as const

export function rollupActivities(
  activities: { manpower: { headcount: number; hours: unknown }[]; materials: { id: string }[] }[],
): { workers: number; manHours: number; materialsCount: number } {
  let workers = 0
  let manHours = 0
  let materialsCount = 0
  for (const a of activities) {
    for (const m of a.manpower) {
      workers += m.headcount
      manHours += m.headcount * Number(m.hours)
    }
    materialsCount += a.materials.length
  }
  return { workers, manHours, materialsCount }
}
