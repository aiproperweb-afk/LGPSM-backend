import { env } from '../config/env';

/** "31 Dec 2026, 4:00 PM" in the platform's time zone: how a payment deadline is written to people */
export function deadlineLabel(date: Date | string | null | undefined): string {
  const d = date ? new Date(date) : null;
  if (!d || Number.isNaN(d.getTime())) return 'the event ends';
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/[  ]/g, ' ');
}
