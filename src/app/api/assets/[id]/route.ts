import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, projectId: true } })
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if ('ref' in body) data.ref = isNonEmptyString(body.ref) ? body.ref.trim() : null
  if ('description' in body) data.description = isNonEmptyString(body.description) ? body.description.trim() : null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data,
    select: { id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'ASSET_UPDATED',
    userId: guard.user.id,
    projectId: asset.projectId,
    entity: 'Asset',
    entityId: asset.id,
    metadata: { fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ asset: updated })
}
