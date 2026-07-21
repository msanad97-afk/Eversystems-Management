import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadProjectEvm, loadActivityEvm } from '@/lib/evm.server'

/** EVM for a project (or an activity-level drill within one asset). ADMIN-only. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const sp = req.nextUrl.searchParams
  const asOfRaw = sp.get('asOf')
  let asOf: Date | undefined
  if (asOfRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD.' }, { status: 400 })
    const d = new Date(`${asOfRaw}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'asOf is not a valid date.' }, { status: 400 })
    asOf = d
  }

  if (sp.get('level') === 'activity') {
    const assetId = sp.get('assetId')
    if (!assetId) return NextResponse.json({ error: 'assetId is required for level=activity.' }, { status: 400 })
    const data = await loadActivityEvm(params.id, assetId, asOf)
    if (!data) return NextResponse.json({ error: 'Asset not found for this project.' }, { status: 404 })
    return NextResponse.json({ evm: data })
  }

  const data = await loadProjectEvm(params.id, asOf)
  if (!data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ evm: data })
}
