/**
 * Report list rollups (Phase C2). Manpower and materials hang off each sub-activity, so
 * per-report totals (workers · man-hours · materials count) are summed across all of a
 * report's activities' sub-activities. One place so every list view stays consistent.
 */

/** Prisma select for a report's activities sufficient to roll up totals. */
export const activityRollupSelect = {
  select: {
    subActivities: {
      select: {
        manpower: { select: { headcount: true, hours: true } },
        materials: { select: { id: true } },
      },
    },
  },
} as const

export function rollupActivities(
  activities: { subActivities: { manpower: { headcount: number; hours: unknown }[]; materials: { id: string }[] }[] }[],
): { workers: number; manHours: number; materialsCount: number } {
  let workers = 0
  let manHours = 0
  let materialsCount = 0
  for (const a of activities) {
    for (const s of a.subActivities) {
      for (const m of s.manpower) {
        workers += m.headcount
        manHours += m.headcount * Number(m.hours)
      }
      materialsCount += s.materials.length
    }
  }
  return { workers, manHours, materialsCount }
}
