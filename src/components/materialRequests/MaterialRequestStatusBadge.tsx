import type { MaterialRequestStatus } from '@prisma/client'
import { Badge } from '@/components/ui/Badge'

const CONFIG: Record<MaterialRequestStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'success' },
  PARTIALLY_APPROVED: { label: 'Partially approved', tone: 'warning' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

export function MaterialRequestStatusBadge({ status }: { status: MaterialRequestStatus }) {
  const { label, tone } = CONFIG[status]
  return <Badge tone={tone}>{label}</Badge>
}
