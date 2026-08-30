import { type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth/permissions'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport } from '@/lib/reports/query'
import { loadReportPdfData } from '@/lib/reports/pdfData.server'
import { renderReportPdf } from '@/lib/pdf/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const bundle = await loadReportPdfData(params.id)
  if (!bundle) return new Response('Not found', { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canReadReport(scope, bundle)) return new Response('Forbidden', { status: 403 })

  const buffer = await renderReportPdf(bundle.data)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${bundle.reportCode}.pdf"`,
    },
  })
}
