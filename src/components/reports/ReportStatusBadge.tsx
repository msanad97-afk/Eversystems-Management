import type { ReportStatus } from '@prisma/client'
import { Badge } from '@/components/ui/Badge'

const CONFIG: Record<ReportStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const { label, tone } = CONFIG[status]
  return <Badge tone={tone}>{label}</Badge>
}
