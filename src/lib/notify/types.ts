import type { NotificationType } from '@prisma/client'

/** Runtime list of the NotificationType enum, for validation and rendering one section per type. */
export const NOTIFICATION_TYPES: NotificationType[] = ['VALUATION_CERTIFIED', 'REPORT_MISSING', 'WEEKLY_SUMMARY', 'ACCOUNTS', 'MATERIAL_REQUEST_MANAGEMENT']

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as string[]).includes(v)
}

/** One-line purpose shown on the admin settings page for each list. */
export const NOTIFICATION_TYPE_INFO: Record<NotificationType, { label: string; description: string }> = {
  VALUATION_CERTIFIED: { label: 'Valuation certified', description: 'Emailed a summary whenever an interim payment certificate is certified.' },
  REPORT_MISSING: { label: 'No report filed', description: 'Emailed at 20:00 Bahrain time when an active project has filed no daily report that day.' },
  WEEKLY_SUMMARY: { label: 'Weekly summary', description: 'Emailed the portfolio + per-project summary PDF every Sunday 08:00 Bahrain, covering the week just ended.' },
  ACCOUNTS: { label: 'Accounts — purchase authorisations', description: 'These addresses receive the purchase authorisation to PLACE THE ORDER whenever a material request is approved (in full or in part), with the procurement letter attached.' },
  MATERIAL_REQUEST_MANAGEMENT: { label: 'Material request — management copy', description: 'Copied (Cc) on every purchase authorisation sent to accounts, for oversight. Not the ones who place the order.' },
}
