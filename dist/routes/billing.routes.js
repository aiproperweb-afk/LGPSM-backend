"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authenticate_1 = require("../middlewares/authenticate");
const authorizeRoles_1 = require("../middlewares/authorizeRoles");
const User_1 = require("../models/User");
const billing_service_1 = require("../services/billing.service");
const billingPdf_service_1 = require("../services/billingPdf.service");
const platformSettings_service_1 = require("../services/platformSettings.service");
const zod_1 = require("zod");
const userRateLimit_1 = require("../middlewares/userRateLimit");
const auditAction_1 = require("../middlewares/auditAction");
const router = (0, express_1.Router)();
// applied per route (not router-wide): this router is mounted at /api/v1, so a blanket guard would also answer 401/403 for unknown paths
const organizerOnly = [authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ORGANIZER)];
const fail = (res, error) => {
    const map = {
        EVENT_NOT_FOUND: [404, 'Event not found'],
        RATE_NOT_SET: [409, 'No per-invitee rate is set for this event yet, so there is nothing to pay.'],
        NOTHING_DUE: [409, 'Nothing is due for this event.'],
        SETTLEMENT_IN_PROGRESS: [409, 'This payment is already being recorded. Please wait a moment.'],
        PAYMENT_PROVIDER_NOT_CONFIGURED: [503, 'Online payments are not configured on this server'],
        PAYMENT_PROVIDER_ERROR: [502, 'The payment provider could not create the order. Please try again.']
    };
    const hit = map[error?.message];
    if (hit)
        return res.status(hit[0]).json({ success: false, message: hit[1] });
    console.error('Billing request failed:', error?.message);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};
// What is billed, paid and due for each of the organizer's events
router.get('/billing/events', organizerOnly, async (req, res) => {
    try {
        return res.json({ success: true, data: await billing_service_1.billingService.listEventBills(req.user.userId) });
    }
    catch (e) {
        return fail(res, e);
    }
});
// The signed-in organizer's own price per invitee and the GST, as the administrator set them. Read only, and nothing else about
// payments: the event assistant shows an estimate from this.
router.get('/billing/rate', organizerOnly, (0, userRateLimit_1.perUserLimit)('billing-rate', { windowMs: 60_000, max: 60 }), async (req, res) => {
    try {
        const [rate, gstPercent] = await Promise.all([platformSettings_service_1.platformSettingsService.rateForOrganizer(req.user.userId), platformSettings_service_1.platformSettingsService.gstPercent()]);
        return res.json({ success: true, data: { ratePerInvitee: rate.effectiveRate, gstPercent, custom: rate.customRate !== null, currency: rate.currency } });
    }
    catch (e) {
        return fail(res, e);
    }
});
// Starts a Razorpay payment for what is due on one event; the client then confirms it through POST /payments/verify
const objectId = zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/);
// `channel` is how the invitations would go (email is free); `purpose: "CARDS"` is a printed card download
const payBody = zod_1.z.object({ eventId: objectId, inviteeIds: zod_1.z.array(objectId).max(5000).optional(), channel: zod_1.z.enum(['EMAIL', 'WHATSAPP', 'BOTH']).optional(), purpose: zod_1.z.literal('CARDS').optional() });
const purposeOf = (b) => (b.purpose === 'CARDS' || !b.channel ? 'CARDS' : b.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP');
// an organizer's own bill; an administrator may look at it too (to ask the organizer to pay), but never pays it
router.post('/billing/quote', authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ORGANIZER, User_1.Role.ADMIN), (0, userRateLimit_1.perUserLimit)('billing-quote', { windowMs: 60_000, max: 60 }), async (req, res) => {
    const parsed = payBody.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ success: false, message: 'A valid eventId is required.' });
    try {
        const user = req.user;
        return res.json({ success: true, data: await billing_service_1.billingService.quote(user.role === User_1.Role.ADMIN ? null : user.userId, parsed.data.eventId, parsed.data.inviteeIds || [], purposeOf(parsed.data)) });
    }
    catch (e) {
        return fail(res, e);
    }
});
// An administrator asks the organizer to pay for the guests to be invited on WhatsApp: it shows as due on the organizer's Billing
router.post('/billing/request', authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ADMIN), (0, userRateLimit_1.perUserLimit)('billing-request', { windowMs: 60_000, max: 20 }), (0, userRateLimit_1.dedupeWindow)('billing-request', 3_000), async (req, res) => {
    const parsed = payBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.inviteeIds?.length)
        return res.status(400).json({ success: false, message: 'A valid eventId and the guests are required.' });
    try {
        return res.status(201).json({ success: true, data: await billing_service_1.billingService.requestPayment(req.user.userId, parsed.data.eventId, parsed.data.inviteeIds) });
    }
    catch (e) {
        return fail(res, e);
    }
});
// An administrator records that the organizer paid outside the platform: everything owed so far, with the guests about to be invited
const settleBody = zod_1.z.object({ eventId: objectId, inviteeIds: zod_1.z.array(objectId).max(5000).optional(), note: zod_1.z.string().trim().max(300).optional() });
router.post('/billing/settle', authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ADMIN), (0, userRateLimit_1.perUserLimit)('billing-settle', { windowMs: 60_000, max: 20 }), (0, userRateLimit_1.dedupeWindow)('billing-settle', 3_000), (0, auditAction_1.auditAction)({ action: 'PAYMENT_SETTLED_OFFLINE', entityType: 'Event', entityParam: undefined, critical: true, describe: 'Offline payment recorded for an event', meta: (req, body) => ({ eventId: req.body?.eventId, amount: body?.data?.total, invitees: body?.data?.invitees, invoice: body?.data?.invoiceNumber, note: req.body?.note }) }), async (req, res) => {
    const parsed = settleBody.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ success: false, message: 'A valid eventId is required, and the note may be up to 300 characters.' });
    try {
        return res.status(201).json({ success: true, data: await billing_service_1.billingService.settleOffline(req.user.userId, parsed.data.eventId, parsed.data.inviteeIds || [], parsed.data.note) });
    }
    catch (e) {
        return fail(res, e);
    }
});
router.post('/billing/pay', organizerOnly, (0, userRateLimit_1.perUserLimit)('billing-pay', { windowMs: 60_000, max: 10, message: 'Too many payment attempts. Please wait a minute and try again.' }), (0, userRateLimit_1.dedupeWindow)('billing-pay', 3_000), async (req, res) => {
    const parsed = payBody.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ success: false, message: 'A valid eventId is required.' });
    try {
        return res.status(201).json({ success: true, data: await billing_service_1.billingService.createBillOrder(req.user.userId, parsed.data.eventId, parsed.data.inviteeIds, purposeOf(parsed.data)) });
    }
    catch (e) {
        return fail(res, e);
    }
});
router.get('/billing/invoices', organizerOnly, async (req, res) => {
    try {
        return res.json({ success: true, data: await billing_service_1.billingService.listInvoices(req.user.userId) });
    }
    catch (e) {
        return fail(res, e);
    }
});
// One PDF: an invoice, or a statement of several payments for the same event (?ids=a,b,c)
router.get('/billing/statement.pdf', organizerOnly, (0, userRateLimit_1.perUserLimit)('billing-pdf', { windowMs: 60_000, max: 60 }), async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.some((i) => !objectId.safeParse(i).success))
        return res.status(400).json({ success: false, message: 'Choose at least one invoice.' });
    try {
        const { pdf, fileName } = await (0, billingPdf_service_1.buildBillingPdf)(req.user.userId, ids);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        return res.send(pdf);
    }
    catch (e) {
        if (e?.statusCode)
            return res.status(e.statusCode).json({ success: false, message: e.message });
        return fail(res, e);
    }
});
exports.default = router;
