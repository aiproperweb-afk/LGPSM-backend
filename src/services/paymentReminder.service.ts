import { Event } from '../models/Event';
import { User, Role } from '../models/User';
import { Notification } from '../models/Notification';
import { env } from '../config/env';
import { sendEmail } from '../utils/email.provider';
import { escapeHtml } from '../utils/html';
import { deadlineLabel } from '../utils/deadline';
import { billingService } from './billing.service';
import { whatsappService } from './whatsapp.service';

/**
 * Pay Later reminders. The organizer pays by the event's end: while something is still owed they are reminded 3 days and 1 day before,
 * and once after it, when the administrators are told too. Each stage is claimed on the event before anything is sent, so it goes out
 * once however many servers sweep, and a stage that has been overtaken (credit given 10 hours before the end) is not sent late.
 */
const DAY = 24 * 60 * 60 * 1000;

type Stage = 'THREE_DAYS' | 'ONE_DAY' | 'OVERDUE';
const stageFor = (msLeft: number): Stage | null => (msLeft <= 0 ? 'OVERDUE' : msLeft <= DAY ? 'ONE_DAY' : msLeft <= 3 * DAY ? 'THREE_DAYS' : null);
const FLAG: Record<Stage, 'payLater.reminded3At' | 'payLater.reminded1At' | 'payLater.overdueAt'> = {
  THREE_DAYS: 'payLater.reminded3At', ONE_DAY: 'payLater.reminded1At', OVERDUE: 'payLater.overdueAt'
};

const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;
const billingUrl = () => `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/billing`;

async function remind(event: any, stage: Stage, due: { invitees: number; total: number; currency: string }) {
  const organizer: any = await User.findById(event.organizerId).select('fullName email phone').lean();
  if (!organizer) return;
  const amount = money(due.total, due.currency);
  const deadline = deadlineLabel(event.schedule?.end);
  const overdue = stage === 'OVERDUE';
  const title = overdue ? `Payment overdue for "${event.title}"` : `Payment due ${stage === 'ONE_DAY' ? 'tomorrow' : 'soon'} for "${event.title}"`;
  const message = overdue
    ? `${amount} (including GST) for ${due.invitees} WhatsApp invitation${due.invitees === 1 ? '' : 's'} was due by ${deadline} and has not been paid. Please pay it from your Billing page.`
    : `Please pay ${amount} (including GST) for ${due.invitees} WhatsApp invitation${due.invitees === 1 ? '' : 's'} before ${deadline}, from your Billing page.`;

  // each way of reaching the organizer is tried on its own: one failing does not stop the others
  const tasks: Array<Promise<unknown>> = [
    Notification.create({ userId: event.organizerId, type: 'PAYMENT', title, message, entityType: 'Event', entityId: event._id, isRead: false })
  ];
  if (organizer.email) {
    tasks.push(sendEmail(
      organizer.email,
      title,
      `<p>Hello ${escapeHtml(organizer.fullName || '')},</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(billingUrl())}">Open Billing</a></p><p style="color:#828282;font-size:12px">If you have already paid, please ignore this message.</p>`
    ));
  }
  if (organizer.phone) {
    tasks.push(whatsappService.sendPaymentReminder({ overdue, recipientPhone: organizer.phone, name: organizer.fullName, eventTitle: event.title, amount, deadline }));
  }
  if (overdue) {
    const name = organizer.fullName || 'The organizer';
    const admins = await User.find({ role: Role.ADMIN, isActive: true }).select('_id email').lean();
    const adminTitle = `Overdue payment: ${event.title}`;
    const adminMessage = `${name} has not paid ${amount} for "${event.title}", which was due by ${deadline}. If you received the money, mark it settled from the event's invitees.`;
    tasks.push(Notification.insertMany(admins.map((a: any) => ({ userId: a._id, type: 'PAYMENT', title: adminTitle, message: adminMessage, entityType: 'Event', entityId: event._id, isRead: false }))));
    for (const a of admins as any[]) if (a.email) tasks.push(sendEmail(a.email, adminTitle, `<p>${escapeHtml(adminMessage)}</p>`));
  }
  const results = await Promise.allSettled(tasks);
  // (a missing WhatsApp template is expected until one is approved, so it is not reported as a failure)
  for (const r of results) {
    if (r.status === 'rejected' && !/TEMPLATE_NOT_CONFIGURED|WHATSAPP_CONFIG_MISSING/.test(String(r.reason?.message))) console.error('Payment reminder could not be delivered:', r.reason?.message);
  }
}

export const paymentReminderService = {
  /** Sends whatever reminders are due at `now`. Returns how many events were reminded. */
  async sweep(now: Date = new Date()): Promise<number> {
    const events: any[] = await Event.find({
      'payLater.setAt': { $ne: null },
      'payLater.overdueAt': null,
      'schedule.end': { $lte: new Date(now.getTime() + 3 * DAY) }
    }).limit(500).lean();
    let reminded = 0;
    for (const event of events) {
      const stage = stageFor(new Date(event.schedule.end).getTime() - now.getTime());
      if (!stage || event.payLater?.[FLAG[stage].split('.')[1]]) continue;
      const due = await billingService.amountDue(event);
      if (due.invitees <= 0 || due.total <= 0) continue;
      // the earlier stages are over once a later one is sent
      const set: Record<string, Date> = { [FLAG[stage]]: now };
      if (stage !== 'THREE_DAYS' && !event.payLater?.reminded3At) set['payLater.reminded3At'] = now;
      if (stage === 'OVERDUE' && !event.payLater?.reminded1At) set['payLater.reminded1At'] = now;
      const claimed = await Event.updateOne({ _id: event._id, [FLAG[stage]]: null }, { $set: set }, { timestamps: false });
      if (!claimed.modifiedCount) continue;
      await remind(event, stage, due);
      reminded += 1;
    }
    return reminded;
  }
};
