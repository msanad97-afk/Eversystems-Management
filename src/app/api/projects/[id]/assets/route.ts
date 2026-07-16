import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const assets = await prisma.asset.findMany({
    where: { projectId: params.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true,
      activities: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, isActive: true, sortOrder: true },
      },
    },
  })

  return NextResponse.json({
    assets: assets.map((a) => ({
      ...a,
      activities: a.activities.map((x) => ({ ...x, boqQuantity: Number(x.boqQuantity) })),
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  if (!name) return NextResponse.json({ error: 'Asset name is required.' }, { status: 400 })

  const count = await prisma.asset.count({ where: { projectId: project.id } })
  const asset = await prisma.asset.create({
    data: {
      projectId: project.id,
      name,
      ref: isNonEmptyString(body.ref) ? body.ref.trim() : null,
      description: isNonEmptyString(body.description) ? body.description.trim() : null,
      sortOrder: count,
    },
    select: { id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'ASSET_CREATED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Asset',
    entityId: asset.id,
    entityCode: project.projectCode,
    metadata: { name },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ asset: { ...asset, activities: [] } }, { status: 201 })
}
