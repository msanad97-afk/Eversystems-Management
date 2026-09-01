import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadRecipientCandidates } from '@/lib/email/history.server'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_INFO } from '@/lib/notify/types'
import { NotificationListsManager, type ListSection } from '@/components/admin/NotificationListsManager'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  await requireAdminPage()

  const [recipients, candidates] = await Promise.all([
    prisma.notificationRecipient.findMany({ orderBy: [{ type: 'asc' }, { address: 'asc' }], select: { id: true, type: true, address: true, userId: true } }),
    loadRecipientCandidates(),
  ])

  const sections: ListSection[] = NOTIFICATION_TYPES.map((type) => ({
    type,
    label: NOTIFICATION_TYPE_INFO[type].label,
    description: NOTIFICATION_TYPE_INFO[type].description,
    recipients: recipients.filter((r) => r.type === type).map((r) => ({ id: r.id, address: r.address, isUser: r.userId != null })),
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Notification lists</h1>
        <p className="mt-1 text-sm text-fg-muted">Global distribution lists for automatic emails. Add an app user or type an address.</p>
      </div>
      <NotificationListsManager sections={sections} candidates={candidates} />
    </div>
  )
}
