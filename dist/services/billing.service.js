"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingService = void 0;
exports.billedGuestsByEvent = billedGuestsByEvent;
exports.priceFor = priceFor;
const mongoose_1 = __importDefault(require("mongoose"));
const Event_1 = require("../models/Event");
const Invitee_1 = require("../models/Invitee");
const Invitation_1 = require("../models/Invitation");
const User_1 = require("../models/User");
const alert_service_1 = require("./alert.service");
const whatsapp_service_1 = require("./whatsapp.service");
const Order_1 = require("../models/Order");
const Payment_1 = require("../models/Payment");
const Invoice_1 = require("../models/Invoice");
const currency_1 = require("../constants/currency");
const order_repository_1 = require("../repositories/order.repository");
const payment_repository_1 = require("../repositories/payment.repository");
const platformSettings_service_1 = require("./platformSettings.service");
const payment_service_1 = require("./payment.service");
const round2 = (n) => Math.round(n * 100) / 100;
const hasMobile = (mobile) => whatsapp_service_1.whatsappService.normalizePhoneNumber(mobile || undefined).length >= 10;
/** The guests each event is billed for: one payment per guest covers a WhatsApp invitation and a printed card alike */
async function billedGuestsByEvent(eventIds) {
    const out = new Map();
    const add = (eventId, guestId) => {
        const key = String(eventId);
        if (!out.has(key))
            out.set(key, new Set());
        out.get(key).add(String(guestId));
    };
    const ids = eventIds.map((id) => new mongoose_1.default.Types.ObjectId(String(id)));
    const [messaged, printed] = await Promise.all([
        Invitation_1.Invitation.find({ eventId: { $in: ids }, $or: [{ whatsappStatus: Invitation_1.InvitationDeliveryStatus.SENT }, { channel: Invitation_1.DeliveryChannel.WHATSAPP, status: Invitation_1.InvitationDeliveryStatus.SENT }] }).select('eventId inviteeId').lean(),
        Invitee_1.Invitee.find({ eventId: { $in: ids }, cardDownloadedAt: { $ne: null } }).setOptions({ includeArchived: true }).select('eventId').lean()
    ]);
    messaged.forEach((i) => add(i.eventId, i.inviteeId));
    printed.forEach((g) => add(g.eventId, g._id));
    return out;
}
async function eventState(event) {
    const locked = event.pricing && event.pricing.lockedAt;
    // The charge per invitee: the rate an administrator set for this organizer when there is one; otherwise the rate locked on the event;
    // and when the event has none, the platform rate the administrator has set (Settings > Price Rate), which is then kept on the event.
    const custom = await platformSettings_service_1.platformSettingsService.customRateOf(event.organizerId);
    let rate = custom ?? (locked ? event.pricing.ratePerInvitee ?? null : await platformSettings_service_1.platformSettingsService.rateInEffectAt(new Date(event.createdAt)));
    // An event created before the admin set a per-head rate has none stored. Billing then uses the admin's current rate and stores
    // it on the event (so the figure stays the same from now on and matches the earnings view); with no rate set anywhere it is free.
    if (!(rate && rate > 0)) {
        const current = await platformSettings_service_1.platformSettingsService.currentRateSnapshot();
        if (current.ratePerInvitee && current.ratePerInvitee > 0) {
            rate = current.ratePerInvitee;
            await Event_1.Event.updateOne({ _id: event._id, $or: [{ 'pricing.ratePerInvitee': null }, { 'pricing.ratePerInvitee': { $exists: false } }, { 'pricing.ratePerInvitee': 0 }] }, { $set: { pricing: current } });
        }
    }
    // an event under an administrator's own account is the platform's own: there is nobody to bill
    if (await User_1.User.exists({ _id: event.organizerId, role: User_1.Role.ADMIN }))
        rate = null;
    const billed = (await billedGuestsByEvent([event._id])).get(String(event._id)) ?? new Set();
    const paid = await Order_1.Order.aggregate([
        { $match: { eventId: event._id, kind: 'EVENT_BILL', status: Order_1.OrderStatus.PAID } },
        { $group: { _id: null, amount: { $sum: '$amount' }, invitees: { $sum: '$invitees' } } }
    ]);
    const covered = paid[0]?.invitees || 0;
    return { rate: rate && rate > 0 ? rate : null, billed, sent: billed.size, covered, paidAmount: round2(paid[0]?.amount || 0) };
}
function priceFor(invitees, rate, gstPercent) {
    const subtotal = round2(invitees * rate);
    const tax = round2((subtotal * gstPercent) / 100);
    return { invitees, rate, subtotal, gstPercent, tax, total: round2(subtotal + tax), currency: currency_1.PLATFORM_CURRENCY };
}
// How many of the chosen guests would be newly billed: those not billed yet (for WhatsApp, only those with a mobile number, as the others
// get nothing on WhatsApp), after using up guests already paid for
async function billableFor(event, inviteeIds, purpose, known) {
    const st = known ?? (await eventState(event));
    const guests = await Invitee_1.Invitee.find({ eventId: event._id, _id: { $in: inviteeIds } }).select('mobile').lean();
    const toSend = guests.filter((g) => !st.billed.has(String(g._id)) && (purpose === 'CARDS' || hasMobile(g.mobile))).length;
    const credit = Math.max(0, st.covered - st.sent);
    return { rate: st.rate, toSend, credit, billable: Math.max(0, toSend - credit) };
}
/** Guests an administrator asked the organizer to pay for that are still unpaid */
async function requestedFor(event, st) {
    const ids = (event.paymentRequest?.inviteeIds || []).map(String);
    if (!ids.length || !st.rate || !whatsapp_service_1.whatsappService.isConfigured())
        return 0;
    return (await billableFor(event, ids, 'WHATSAPP', st)).billable;
}
async function eventBill(event, gstPercent) {
    const st = await eventState(event);
    const requestedInvitees = await requestedFor(event, st);
    const dueInvitees = st.rate ? Math.max(0, st.sent - st.covered) + requestedInvitees : 0;
    const due = st.rate ? priceFor(dueInvitees, st.rate, gstPercent) : null;
    return {
        eventId: String(event._id),
        eventName: event.title,
        eventStart: event.schedule?.start,
        invitesSent: st.sent,
        /** of the amount due, the guests an administrator is waiting to invite */
        requestedInvitees,
        ratePerInvitee: st.rate,
        gstPercent,
        paid: st.paidAmount,
        dueInvitees,
        dueSubtotal: due?.subtotal ?? 0,
        dueTax: due?.tax ?? 0,
        due: due?.total ?? 0,
        currency: currency_1.PLATFORM_CURRENCY
    };
}
exports.billingService = {
    /**
     * A WhatsApp invitation or a printed card is paid for before it happens: refuses (PAYMENT_REQUIRED) when the event has a rate and the chosen
     * guests are not covered by payments already made. The screens show the bill first, but the server is what keeps one from going out unpaid,
     * whichever screen or tool asks. Email is free, and nothing is charged for WhatsApp while the server cannot send it.
     */
    async assertPaidFor(event, inviteeIds, purpose) {
        if (purpose === 'WHATSAPP' && !whatsapp_service_1.whatsappService.isConfigured())
            return;
        const b = await billableFor(event, inviteeIds, purpose);
        if (b.rate !== null && b.billable > 0)
            throw Object.assign(new Error('PAYMENT_REQUIRED'), { billable: b.billable });
    },
    /** The organizer's events with what is billed, paid and due for each. */
    async listEventBills(organizerId) {
        const gst = await platformSettings_service_1.platformSettingsService.gstPercent();
        const all = await Event_1.Event.find({ organizerId })
            .select('title schedule createdAt pricing organizerId status paymentRequest')
            .sort({ 'schedule.start': -1 })
            .lean();
        // a cancelled event has nothing left to pay; its past payments still count below
        const events = all.filter((e) => e.status !== 'CANCELLED');
        const rows = [];
        for (const e of events)
            rows.push(await eventBill(e, gst));
        const shown = rows.filter((r) => r.invitesSent > 0 || r.paid > 0 || r.dueInvitees > 0);
        // the payments themselves (only ones that went through), newest first: the dashboard's "this month" and "last billed" come from these
        const titleOf = new Map(all.map((e) => [String(e._id), e.title]));
        // a deleted event is named from its invoices
        const kept = await Invoice_1.Invoice.find({ userId: new mongoose_1.default.Types.ObjectId(organizerId), eventName: { $exists: true } }).select('eventId eventName').lean();
        for (const i of kept)
            if (!titleOf.has(String(i.eventId)))
                titleOf.set(String(i.eventId), i.eventName);
        const paidOrders = await Order_1.Order.find({ userId: organizerId, kind: 'EVENT_BILL', status: Order_1.OrderStatus.PAID }).sort({ updatedAt: -1 }).limit(100).select('eventId amount updatedAt').lean();
        const payments = paidOrders.map((o) => ({ eventId: String(o.eventId), eventName: titleOf.get(String(o.eventId)) || 'Event', amount: round2(o.amount || 0), at: o.updatedAt }));
        const paidSum = await Order_1.Order.aggregate([{ $match: { userId: new mongoose_1.default.Types.ObjectId(organizerId), kind: 'EVENT_BILL', status: Order_1.OrderStatus.PAID } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]);
        return {
            currency: currency_1.PLATFORM_CURRENCY,
            gstPercent: gst,
            /** everything this organizer has really paid (payments that went through), across all their events */
            paidTotal: round2(paidSum[0]?.amount || 0),
            payments,
            totalDue: round2(shown.reduce((s, r) => s + r.due, 0)),
            totalPaid: round2(shown.reduce((s, r) => s + r.paid, 0)),
            events: shown
        };
    },
    /**
     * The bill for the chosen guests: guests x rate, GST, total. Nothing is created. Email is free; `organizerId` null is an administrator
     * looking at the organizer's bill.
     */
    async quote(organizerId, eventId, inviteeIds, purpose = 'CARDS') {
        const event = await Event_1.Event.findOne({ _id: eventId, ...(organizerId ? { organizerId } : {}) }).lean();
        if (!event)
            throw new Error('EVENT_NOT_FOUND');
        const gst = await platformSettings_service_1.platformSettingsService.gstPercent();
        const owner = await User_1.User.findById(event.organizerId).select('fullName profile.organizationName').lean();
        const whatsappUnavailable = purpose === 'WHATSAPP' && !whatsapp_service_1.whatsappService.isConfigured();
        const b = purpose === 'EMAIL' || whatsappUnavailable ? { ...(await billableFor(event, [], 'CARDS')), toSend: 0, billable: 0 } : await billableFor(event, inviteeIds, purpose);
        const price = priceFor(b.billable, b.rate ?? 0, gst);
        return {
            ...price, rate: b.rate, selected: b.toSend, alreadyPaid: Math.min(b.toSend, b.credit), payable: b.rate !== null && b.billable > 0,
            free: purpose === 'EMAIL', whatsappUnavailable, organizerName: owner?.profile?.organizationName || owner?.fullName || 'The organizer'
        };
    },
    /** An administrator asks the organizer to pay for guests the administrator wants to invite on WhatsApp */
    async requestPayment(adminId, eventId, inviteeIds) {
        const event = await Event_1.Event.findById(eventId).lean();
        if (!event)
            throw new Error('EVENT_NOT_FOUND');
        const ids = [...new Set([...(event.paymentRequest?.inviteeIds || []).map(String), ...inviteeIds])];
        await Event_1.Event.updateOne({ _id: event._id }, { $set: { paymentRequest: { inviteeIds: ids, requestedBy: adminId, requestedAt: new Date() } } }, { timestamps: false });
        const quote = await this.quote(null, eventId, ids, 'WHATSAPP');
        if (!quote.payable)
            return { requested: false, ...quote };
        await alert_service_1.alertService.notifyUser(event.organizerId, {
            type: 'PAYMENT', title: 'Payment needed for WhatsApp invitations',
            message: `Please pay for ${quote.invitees} WhatsApp invitation${quote.invitees === 1 ? '' : 's'} for "${event.title}" (${quote.currency} ${quote.total.toFixed(2)}, including GST) from your Billing page. They are sent once it is paid.`,
            entityType: 'Event', entityId: event._id
        });
        return { requested: true, ...quote };
    },
    /**
     * Creates the Razorpay order. With `inviteeIds` it is the bill for those guests; without, it is whatever is due on the event (guests
     * already invited on WhatsApp or given cards, and guests an administrator asked to have paid for).
     */
    async createBillOrder(organizerId, eventId, inviteeIds, purpose = 'CARDS') {
        const event = await Event_1.Event.findOne({ _id: eventId, organizerId }).lean();
        if (!event)
            throw new Error('EVENT_NOT_FOUND');
        const gst = await platformSettings_service_1.platformSettingsService.gstPercent();
        let count;
        let rate;
        if (inviteeIds && inviteeIds.length) {
            if (purpose === 'EMAIL')
                throw new Error('NOTHING_DUE');
            const b = await billableFor(event, inviteeIds, purpose);
            count = b.billable;
            rate = b.rate;
        }
        else {
            const st = await eventState(event);
            rate = st.rate;
            count = st.rate ? Math.max(0, st.sent - st.covered) + (await requestedFor(event, st)) : 0;
        }
        if (rate === null)
            throw new Error('RATE_NOT_SET');
        if (count <= 0)
            throw new Error('NOTHING_DUE');
        const price = priceFor(count, rate, gst);
        if (price.total <= 0)
            throw new Error('NOTHING_DUE');
        const { keyId } = (0, payment_service_1.getRazorpayCredentials)();
        const rzp = await (0, payment_service_1.createRazorpayOrder)(Math.round(price.total * 100), currency_1.PLATFORM_CURRENCY, `bill_${String(event._id).slice(-8)}_${Date.now()}`);
        const providerOrderId = rzp.id;
        const order = await order_repository_1.orderRepository.create({
            kind: 'EVENT_BILL',
            userId: organizerId,
            eventId: event._id,
            quantity: 1,
            invitees: count,
            amount: price.total,
            subtotal: price.subtotal,
            tax: price.tax,
            gstPercent: gst,
            currency: currency_1.PLATFORM_CURRENCY,
            providerOrderId,
            status: Order_1.OrderStatus.PENDING
        });
        await payment_repository_1.paymentRepository.create({
            orderId: order._id,
            userId: organizerId,
            eventId: event._id,
            provider: 'RAZORPAY',
            providerOrderId,
            amountBase: price.subtotal,
            taxAmount: price.tax,
            totalAmount: price.total,
            currency: currency_1.PLATFORM_CURRENCY,
            status: Payment_1.PaymentStatus.CREATED,
            signatureVerified: false
        });
        return {
            keyId,
            providerOrderId,
            amount: rzp.amount,
            eventId: String(event._id),
            eventName: event.title,
            ...price
        };
    },
    /** The organizer's paid invoices, shaped for the Billing list and statement. */
    async listInvoices(organizerId) {
        const invoices = await Invoice_1.Invoice.find({ userId: new mongoose_1.default.Types.ObjectId(organizerId) }).sort({ issuedAt: -1 }).lean();
        const found = await Event_1.Event.find({ _id: { $in: invoices.map((i) => i.eventId) } }).select('title').lean();
        const titles = new Map(found.map((e) => [String(e._id), e.title]));
        return invoices.map((i) => ({
            id: String(i._id),
            invoiceId: i.invoiceNumber,
            eventId: String(i.eventId),
            eventName: titles.get(String(i.eventId)) || i.eventName || 'Event',
            invitees: i.invitees ?? 0,
            paymentDate: new Date(i.issuedAt).toISOString(),
            subtotal: i.subtotal,
            tax: i.tax,
            amount: i.total,
            currency: currency_1.PLATFORM_CURRENCY
        }));
    }
};
