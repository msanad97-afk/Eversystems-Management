import { requireAdminPage } from '@/lib/auth/permissions'
import { loadOpenAlerts } from '@/lib/deliveries/alertsView.server'
import { AlertsClient } from '@/components/deliveries/AlertsClient'

export const dynamic = 'force-dynamic'

export default async function AdminAlertsPage() {
  await requireAdminPage()
  const alerts = await loadOpenAlerts()
  return <AlertsClient initialAlerts={alerts} />
}
