import { prisma } from '@/lib/prisma'
import { loadReportPdfData } from '@/lib/reports/pdfData.server'
import { loadMaterialRequestLetter } from '@/lib/materialRequests/letter.server'
import { renderReportPdf, renderMaterialRequestPdf } from '@/lib/pdf/render'
import type { MailAttachment } from '@/lib/email/transport'
import type { EmailEntityType } from '@/lib/email/send.server'

/**
 * Resolves a sendable entity to the document that goes out with it.
 *
 * The PDF is produced by the SAME loaders + renderers the download routes use
 * (loadReportPdfData → renderReportPdf, loadMaterialRequestLetter → renderMaterialRequestPdf),
 * so an emailed document can never drift from a downloaded one. Rendering is in-memory only.
 *
 * Sendable state is enforced here, once, for every caller:
 *   DAILY_REPORT      → APPROVED only (a draft/submitted/rejected report is not a record yet)
 *   MATERIAL_REQUEST  → reviewed only (never a draft or a request still awaiting review)
 */

export const EMAIL_ENTITY_TYPES: EmailEntityType[] = ['DAILY_REPORT', 'MATERIAL_REQUEST']

export function isEmailEntityType(v: unknown): v is EmailEntityType {
  return typeof v === 'string' && (EMAIL_ENTITY_TYPES as string[]).includes(v)
}

export interface SendableDocument {
  entityType: EmailEntityType
  entityId: string
  entityCode: string
  projectId: string
  projectName: string
  subject: string
  /** Human context prepended to the sender's optional message. */
  intro: string
  attachment: MailAttachment
}

export type ResolveDocumentResult =
  | { ok: true; doc: SendableDocument }
  | { ok: false; status: 404 | 409; error: string }

async function resolveReport(id: string): Promise<ResolveDocumentResult> {
  const bundle = await loadReportPdfData(id)
  if (!bundle) return { ok: false, status: 404, error: 'Report not found.' }
  if (bundle.status !== 'APPROVED') {
    return {
      ok: false,
      status: 409,
      error: `Only an approved report can be sent by email. This report is ${bundle.status.toLowerCase()}.`,
    }
  }

  const content = await renderReportPdf(bundle.data)
  return {
    ok: true,
    doc: {
      entityType: 'DAILY_REPORT',
      entityId: bundle.reportId,
      entityCode: bundle.reportCode,
      projectId: bundle.projectId,
      projectName: bundle.projectName,
      subject: `Daily report ${bundle.reportCode} — ${bundle.projectName} (${bundle.reportDate})`,
      intro: `Please find attached the approved daily report ${bundle.reportCode} for ${bundle.projectName}, dated ${bundle.reportDate}.`,
      attachment: { filename: `${bundle.reportCode}.pdf`, contentType: 'application/pdf', content },
    },
  }
}

async function resolveMaterialRequest(id: string): Promise<ResolveDocumentResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id },
    select: { id: true, requestCode: true, status: true, projectId: true, project: { select: { name: true } } },
  })
  if (!request) return { ok: false, status: 404, error: 'Material request not found.' }
  if (request.status === 'DRAFT' || request.status === 'SUBMITTED') {
    return {
      ok: false,
      status: 409,
      error:
        request.status === 'DRAFT'
          ? 'This request is still a draft. Only a reviewed request can be sent by email.'
          : 'This request is awaiting review. Only a reviewed request can be sent by email.',
    }
  }

  // Reviewed but fully rejected → no approved lines, so there is no procurement letter.
  const letter = await loadMaterialRequestLetter(id)
  if (!letter) {
    return {
      ok: false,
      status: 409,
      error: 'This request has no approved quantities, so there is no letter to send.',
    }
  }

  const content = await renderMaterialRequestPdf(letter.data)
  return {
    ok: true,
    doc: {
      entityType: 'MATERIAL_REQUEST',
      entityId: request.id,
      entityCode: request.requestCode,
      projectId: request.projectId,
      projectName: request.project.name,
      subject: `Material request ${request.requestCode} — ${request.project.name}`,
      intro: `Please find attached material request ${request.requestCode} for ${request.project.name}, listing the approved quantities.`,
      attachment: { filename: `${request.requestCode}.pdf`, contentType: 'application/pdf', content },
    },
  }
}

export function resolveSendableDocument(
  entityType: EmailEntityType,
  entityId: string,
): Promise<ResolveDocumentResult> {
  return entityType === 'DAILY_REPORT' ? resolveReport(entityId) : resolveMaterialRequest(entityId)
}
