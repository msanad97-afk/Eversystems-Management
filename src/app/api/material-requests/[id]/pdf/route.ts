import { type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth/permissions'
import { loadMaterialRequestLetter } from '@/lib/materialRequests/letter.server'
import { renderMaterialRequestPdf } from '@/lib/pdf/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Material-request letter (PDF), quantities only. Available on REVIEWED requests to the author
 * (supervisor who takes it to procurement) or an ADMIN. No cost is loaded or rendered.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const letter = await loadMaterialRequestLetter(params.id)
  // Null = not found or not reviewed (drafts/pending are not printable).
  if (!letter) return new Response('Not found', { status: 404 })

  const isAuthor = letter.requestedById === guard.user.id
  const isAdmin = guard.user.role === 'ADMIN'
  if (!isAuthor && !isAdmin) return new Response('Forbidden', { status: 403 })

  const buffer = await renderMaterialRequestPdf(letter.data)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${letter.data.requestCode}.pdf"`,
    },
  })
}
