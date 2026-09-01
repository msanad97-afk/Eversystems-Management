import type { NotificationType } from '@prisma/client'

/** Runtime list of the NotificationType enum, for validation and rendering one section per type. */
export const NOTIFICATION_TYPES: NotificationType[] = ['VALUATION_CERTIFIED', 'REPORT_MISSING', 'WEEKLY_SUMMARY']

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as string[]).includes(v)
}

/** One-line purpose shown on the admin settings page for each list. */
export const NOTIFICATION_TYPE_INFO: Record<NotificationType, { label: string; description: string }> = {
  VALUATION_CERTIFIED: { label: 'Valuation certified', description: 'Emailed a summary whenever an interim payment certificate is certified.' },
  REPORT_MISSING: { label: 'No report filed', description: 'Emailed at 20:00 Bahrain time when an active project has filed no daily report that day.' },
  WEEKLY_SUMMARY: { label: 'Weekly summary', description: 'Reserved for the weekly project summary (Phase C) — not sent yet.' },
}
