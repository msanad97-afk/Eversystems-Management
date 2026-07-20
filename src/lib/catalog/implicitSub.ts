import type { Prisma } from '@prisma/client'
import { IMPLICIT_SUBACTIVITY_NAME } from './constants'

/**
 * Phase C2: every activity must have at least one sub-activity so all reporting runs one
 * code path at the sub-activity level. When an activity has no NAMED sub-activities, it
 * carries a single hidden implicit sub — measured (no budget rows) for a bare measured
 * line, or lumpsum (mirroring the activity's frozen BHD) for a lumpsum line. The implicit
 * row is never shown in any UI.
 */
export function implicitSubActivityCreate(
  type: 'MEASURED' | 'LUMPSUM',
  lumpsumBhd: number | null,
): Prisma.SubActivityCreateWithoutActivityInput {
  return {
    name: IMPLICIT_SUBACTIVITY_NAME,
    type,
    isImplicit: true,
    lumpsumBhd: type === 'LUMPSUM' ? lumpsumBhd : null,
    sortOrder: 0,
  }
}
