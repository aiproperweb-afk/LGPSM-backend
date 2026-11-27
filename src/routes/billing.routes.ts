import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorizeRoles } from '../middlewares/authorizeRoles';
import { Role } from '../models/User';
import { billingService } from '../services/billing.service';
import { buildBillingPdf } from '../services/billingPdf.service';
import { platformSettingsService } from '../services/platformSettings.service';
import { z } from 'zod';
import { perUserLimit, dedupeWindow } from '../middlewares/userRateLimit';
import { auditAction } from '../middlewares/auditAction';

const router = Router();
// applied per route (not router-wide): this router is mounted at /api/v1, so a blanket guard would also answer 401/403 for unknown paths
const organizerOnly = [authenticate, authorizeRoles(Role.ORGANIZER)];

const fail = (res: Response, error: any) => {
  const map: Record<string, [number, string]> = {
    EVENT_NOT_FOUND: [404, 'Event not found'],
    RATE_NOT_SET: [409, 'No per-invitee rate is set for this event yet, so there is nothing to pay.'],
    NOTHING_DUE: [409, 'Nothing is due for this event.'],
    SETTLEMENT_IN_PROGRESS: [409, 'This payment is already being recorded. Please wait a moment.'],
    PAYMENT_PROVIDER_NOT_CONFIGURED: [503, 'Online payments are not configured on this server'],
    PAYMENT_PROVIDER_ERROR: [502, 'The payment provider could not create the order. Please try again.']
  };
  const hit = map[error?.message];
  if (hit) return res.status(hit[0]).json({ success: false, message: hit[1] });
  console.error('Billing request failed:', error?.message);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

// What is billed, paid and due for each of the organizer's events
router.get('/billing/events', organizerOnly, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await billingService.listEventBills((req as any).user.userId) });
  } catch (e) { return fail(res, e); }
});

// The signed-in organizer's own price per invitee and the GST, as the administrator set them. Read only, and nothing else about
// payments: the event assistant shows an estimate from this.
router.get('/billing/rate', organizerOnly, perUserLimit('billing-rate', { windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  try {
    const [rate, gstPercent] = await Promise.all([platformSettingsService.rateForOrganizer((req as any).user.userId), platformSettingsService.gstPercent()]);
    return res.json({ success: true, data: { ratePerInvitee: rate.effectiveRate, gstPercent, custom: rate.customRate !== null, currency: rate.currency } });
  } catch (e) { return fail(res, e); }
});

// Starts a Razorpay payment for what is due on one event; the client then confirms it through POST /payments/verify
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);
// `channel` is how the invitations would go (email is free); `purpose: "CARDS"` is a printed card download
const payBody = z.object({ eventId: objectId, inviteeIds: z.array(objectId).max(5000).optional(), channel: z.enum(['EMAIL', 'WHATSAPP', 'BOTH']).optional(), purpose: z.literal('CARDS').optional() });
const purposeOf = (b: { channel?: string; purpose?: string }) => (b.purpose === 'CARDS' || !b.channel ? 'CARDS' as const : b.channel === 'EMAIL' ? 'EMAIL' as const : 'WHATSAPP' as const);

// an organizer's own bill; an administrator may look at it too (to ask the organizer to pay), but never pays it
router.post('/billing/quote', authenticate, authorizeRoles(Role.ORGANIZER, Role.ADMIN), perUserLimit('billing-quote', { windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  const parsed = payBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'A valid eventId is required.' });
  try {
    const user = (req as any).user;
    return res.json({ success: true, data: await billingService.quote(user.role === Role.ADMIN ? null : user.userId, parsed.data.eventId, parsed.data.inviteeIds || [], purposeOf(parsed.data)) });
  } catch (e) { return fail(res, e); }
});

// An administrator asks the organizer to pay for the guests to be invited on WhatsApp: it shows as due on the organizer's Billing
router.post('/billing/request', authenticate, authorizeRoles(Role.ADMIN), perUserLimit('billing-request', { windowMs: 60_000, max: 20 }), dedupeWindow('billing-request', 3_000), async (req: Request, res: Response) => {
  const parsed = payBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.inviteeIds?.length) return res.status(400).json({ success: false, message: 'A valid eventId and the guests are required.' });
  try {
    return res.status(201).json({ success: true, data: await billingService.requestPayment((req as any).user.userId, parsed.data.eventId, parsed.data.inviteeIds) });
  } catch (e) { return fail(res, e); }
});

// An administrator records that the organizer paid outside the platform: everything owed so far, with the guests about to be invited
const settleBody = z.object({ eventId: objectId, inviteeIds: z.array(objectId).max(5000).optional(), note: z.string().trim().max(300).optional() });
router.post('/billing/settle', authenticate, authorizeRoles(Role.ADMIN), perUserLimit('billing-settle', { windowMs: 60_000, max: 20 }), dedupeWindow('billing-settle', 3_000),
  auditAction({ action: 'PAYMENT_SETTLED_OFFLINE', entityType: 'Event', entityParam: undefined, critical: true, describe: 'Offline payment recorded for an event', meta: (req, body) => ({ eventId: req.body?.eventId, amount: body?.data?.total, invitees: body?.data?.invitees, invoice: body?.data?.invoiceNumber, note: req.body?.note }) }),
  async (req: Request, res: Response) => {
    const parsed = settleBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'A valid eventId is required, and the note may be up to 300 characters.' });
    try {
      return res.status(201).json({ success: true, data: await billingService.settleOffline((req as any).user.userId, parsed.data.eventId, parsed.data.inviteeIds || [], parsed.data.note) });
    } catch (e) { return fail(res, e); }
  });

router.post('/billing/pay', organizerOnly, perUserLimit('billing-pay', { windowMs: 60_000, max: 10, message: 'Too many payment attempts. Please wait a minute and try again.' }), dedupeWindow('billing-pay', 3_000), async (req: Request, res: Response) => {
  const parsed = payBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'A valid eventId is required.' });
  try {
    return res.status(201).json({ success: true, data: await billingService.createBillOrder((req as any).user.userId, parsed.data.eventId, parsed.data.inviteeIds, purposeOf(parsed.data)) });
  } catch (e) { return fail(res, e); }
});

router.get('/billing/invoices', organizerOnly, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await billingService.listInvoices((req as any).user.userId) });
  } catch (e) { return fail(res, e); }
});

// One PDF: an invoice, or a statement of several payments for the same event (?ids=a,b,c)
router.get('/billing/statement.pdf', organizerOnly, perUserLimit('billing-pdf', { windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((i) => !objectId.safeParse(i).success)) return res.status(400).json({ success: false, message: 'Choose at least one invoice.' });
  try {
    const { pdf, fileName } = await buildBillingPdf((req as any).user.userId, ids);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(pdf);
  } catch (e: any) {
    if (e?.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    return fail(res, e);
  }
});

export default router;
