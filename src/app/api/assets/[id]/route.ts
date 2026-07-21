import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, projectId: true, lumpsumRevenue: true } })
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if ('ref' in body) data.ref = isNonEmptyString(body.ref) ? body.ref.trim() : null
  if ('description' in body) data.description = isNonEmptyString(body.description) ? body.description.trim() : null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

  // Phase 6D: the client bill value for this asset's lump-sum scope — the only revenue path
  // lump-sum work has. Null clears it (back to "not agreed yet").
  let lumpsumRevenueChange: { from: number | null; to: number | null } | null = null
  if ('lumpsumRevenue' in body) {
    const raw = body.lumpsumRevenue
    if (raw == null || raw === '') {
      data.lumpsumRevenue = null
    } else {
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: 'lumpsumRevenue must be a non-negative number, or null to clear it.' }, { status: 400 })
      }
      data.lumpsumRevenue = value
    }
    lumpsumRevenueChange = {
      from: asset.lumpsumRevenue == null ? null : Number(asset.lumpsumRevenue),
      to: data.lumpsumRevenue as number | null,
    }
  }

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data,
    select: { id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true, lumpsumRevenue: true },
  })

  writeAuditLog({
    action: 'ASSET_UPDATED',
    userId: guard.user.id,
    projectId: asset.projectId,
    entity: 'Asset',
    entityId: asset.id,
    metadata: { fields: Object.keys(data), ...(lumpsumRevenueChange ? { lumpsumRevenue: lumpsumRevenueChange } : {}) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({
    asset: { ...updated, lumpsumRevenue: updated.lumpsumRevenue == null ? null : Number(updated.lumpsumRevenue) },
  })
}
