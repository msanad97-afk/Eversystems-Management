import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/** Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/**
 * Bulk-create assets + activities from CSV. Columns: asset, activity ref, activity name,
 * unit, boq quantity. Atomic: if ANY row is invalid, nothing is created and the row-level
 * errors are returned. Assets are created on the fly and deduped by name within the project.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const csv = typeof body?.csv === 'string' ? body.csv : ''
  if (!csv.trim()) return NextResponse.json({ error: 'CSV content is empty.' }, { status: 400 })

  const cells = parseCsv(csv)
  if (cells.length === 0) return NextResponse.json({ error: 'CSV has no rows.' }, { status: 400 })

  // Skip a header row if the first row looks like column names.
  const firstJoined = cells[0]!.map((c) => c.trim().toLowerCase()).join(',')
  const start = firstJoined.includes('asset') && firstJoined.includes('activity') ? 1 : 0

  const errors: { row: number; message: string }[] = []
  const parsed: { assetName: string; activityRef: string | null; activityName: string; unit: string; boq: number }[] = []

  for (let i = start; i < cells.length; i++) {
    const c = cells[i]!.map((x) => x.trim())
    const assetName = c[0] ?? ''
    const activityRef = c[1] ?? ''
    const activityName = c[2] ?? ''
    const unit = c[3] ?? ''
    const boq = Number(c[4] ?? '')
    const rowErrs: string[] = []
    if (!assetName) rowErrs.push('asset is required')
    if (!activityName) rowErrs.push('activity name is required')
    if (!unit) rowErrs.push('unit is required')
    if (!Number.isFinite(boq) || boq <= 0) rowErrs.push('boq quantity must be a number greater than 0')
    if (rowErrs.length > 0) errors.push({ row: i + 1, message: rowErrs.join('; ') })
    else parsed.push({ assetName, activityRef: activityRef || null, activityName, unit, boq })
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Some rows are invalid; nothing was imported.', errors }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const assetIdByName = new Map<string, string>()
    const existing = await tx.asset.findMany({ where: { projectId: project.id, isActive: true }, select: { id: true, name: true } })
    for (const a of existing) assetIdByName.set(a.name.toLowerCase(), a.id)
    let assetOrder = await tx.asset.count({ where: { projectId: project.id } })
    const activityOrder = new Map<string, number>()
    let createdAssets = 0
    let createdActivities = 0

    for (const r of parsed) {
      let assetId = assetIdByName.get(r.assetName.toLowerCase())
      if (!assetId) {
        const asset = await tx.asset.create({ data: { projectId: project.id, name: r.assetName, sortOrder: assetOrder++ } })
        assetId = asset.id
        assetIdByName.set(r.assetName.toLowerCase(), assetId)
        createdAssets++
      }
      let order = activityOrder.get(assetId)
      if (order === undefined) order = await tx.activity.count({ where: { assetId } })
      await tx.activity.create({
        data: { assetId, name: r.activityName, ref: r.activityRef, unit: r.unit, boqQuantity: r.boq, sortOrder: order },
      })
      activityOrder.set(assetId, order + 1)
      createdActivities++
    }
    return { createdAssets, createdActivities }
  })

  writeAuditLog({
    action: 'ACTIVITY_CREATED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Project',
    entityId: project.id,
    entityCode: project.projectCode,
    metadata: { op: 'boq_import', ...result },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, ...result }, { status: 201 })
}
