import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { catalogSubRateInclude, copiedSubActivityCreate } from '@/lib/catalog/snapshot'

/**
 * Add ONE sub-activity to an already-placed project activity (ADMIN). Two modes in one endpoint:
 *
 *  (a) FROM CATALOG — body carries `catalogSubActivityId`. It must belong to the parent's
 *      `catalogActivityId`; it is deep-copied EXACTLY as placement does (shared helper), stamping
 *      costRateAtPlacement from the CURRENT global rate so the new scope contributes to BAC.
 *  (b) ONE-OFF — body carries `name`, `type`, and (for LUMPSUM) `lumpsumBhd`. Created with NO
 *      budget rows; the admin prices it afterwards through the existing budget/re-price paths.
 *
 * BAC and physical % are derived at read time, so the new active sub is picked up on the next load
 * with no refresh — increasing BAC and (with zero progress) lowering the activity's physical %.
 * We never touch BaselinePeriod (PV re-prices itself) or any certified valuation (frozen).
 *
 * A flat activity whose ONLY active sub is the implicit one is rejected (409): adding a named sub
 * beside the implicit row would leak the hidden line into the supervisor's report form, and
 * repurposing it would rename what existing reports were recorded against.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, isActive: true, catalogActivityId: true,
      asset: { select: { projectId: true } },
      subActivities: { select: { name: true, isActive: true, isImplicit: true, sortOrder: true } },
    },
  })
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!activity.isActive) return NextResponse.json({ error: 'This activity is not active.' }, { status: 409 })

  const activeSubs = activity.subActivities.filter((s) => s.isActive)
  if (activeSubs.length === 1 && activeSubs[0]!.isImplicit) {
    return NextResponse.json(
      { error: 'This activity is a flat line with no named sub-activities. Structuring it is not supported yet — contact the administrator.' },
      { status: 409 },
    )
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const nextSort = activity.subActivities.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1
  // The (activityId, name) unique constraint forbids ANY same-name sub (active or removed), so a
  // clash against either is a 409 rather than a DB-level 500.
  const nameClashes = (name: string) => activity.subActivities.some((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())

  // ─── Mode (a): FROM CATALOG ───
  if (isNonEmptyString(body.catalogSubActivityId)) {
    if (!activity.catalogActivityId) {
      return NextResponse.json({ error: 'This activity was not placed from the catalogue, so it has no catalogue sub-activities to copy.' }, { status: 400 })
    }
    const catSub = await prisma.catalogSubActivity.findUnique({
      where: { id: body.catalogSubActivityId.trim() },
      include: catalogSubRateInclude,
    })
    if (!catSub || catSub.catalogActivityId !== activity.catalogActivityId) {
      return NextResponse.json({ error: 'That catalogue sub-activity does not belong to this activity’s template.' }, { status: 400 })
    }
    if (nameClashes(catSub.name)) {
      return NextResponse.json({ error: `A sub-activity named “${catSub.name}” is already on this activity.` }, { status: 409 })
    }

    const created = await prisma.$transaction((tx) =>
      tx.subActivity.create({
        // Copy exactly as placement: rates + costRateAtPlacement frozen from current global rates.
        // Never carry the catalogue row's isImplicit; a named sub is always explicit here.
        data: { activityId: activity.id, ...copiedSubActivityCreate(catSub), isImplicit: false, sortOrder: nextSort },
        select: { id: true, name: true, type: true },
      }),
    )

    writeAuditLog({
      action: 'SUBACTIVITY_ADDED',
      userId: guard.user.id,
      projectId: activity.asset.projectId,
      entity: 'SubActivity',
      entityId: created.id,
      metadata: { activityId: activity.id, activityName: activity.name, subActivityName: created.name, source: activity.catalogActivityId },
      ipAddress: getClientIp(req),
    })
    return NextResponse.json({ subActivity: created }, { status: 201 })
  }

  // ─── Mode (b): ONE-OFF ───
  if (!isNonEmptyString(body.name)) return NextResponse.json({ error: 'A sub-activity name is required.' }, { status: 400 })
  const name = body.name.trim()
  const type = body.type === 'LUMPSUM' ? 'LUMPSUM' : body.type === 'MEASURED' ? 'MEASURED' : null
  if (!type) return NextResponse.json({ error: 'Sub-activity type must be MEASURED or LUMPSUM.' }, { status: 400 })

  let lumpsumBhd: number | null = null
  if (type === 'LUMPSUM') {
    const n = Number(body.lumpsumBhd)
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'A LUMPSUM sub-activity needs a lumpsum cost greater than 0.' }, { status: 400 })
    lumpsumBhd = n
  }
  if (nameClashes(name)) return NextResponse.json({ error: `A sub-activity named “${name}” is already on this activity.` }, { status: 409 })

  const created = await prisma.$transaction((tx) =>
    tx.subActivity.create({
      // One-off: no budget rows — the admin prices it afterwards through the existing paths.
      data: { activityId: activity.id, name, type, lumpsumBhd, sortOrder: nextSort, isImplicit: false },
      select: { id: true, name: true, type: true },
    }),
  )

  writeAuditLog({
    action: 'SUBACTIVITY_ADDED',
    userId: guard.user.id,
    projectId: activity.asset.projectId,
    entity: 'SubActivity',
    entityId: created.id,
    metadata: { activityId: activity.id, activityName: activity.name, subActivityName: created.name, source: 'one-off' },
    ipAddress: getClientIp(req),
  })
  return NextResponse.json({ subActivity: created }, { status: 201 })
}
