"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingService = void 0;
exports.billedGuestsByEvent = billedGuestsByEvent;
exports.priceFor = priceFor;
const crypto_1 = __importDefault(require("crypto"));
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
const invoice_repository_1 = require("../repositories/invoice.repository");
const deadline_1 = require("../utils/deadline");
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
    // Guests invited on credit (Pay Later) and still owed for. Their debt does not eat the credit of a later payment for new guests:
    // only payments made against what is owed reduce it.
    const onCredit = (event.payLater?.inviteeIds || []).filter((id) => billed.has(String(id))).length;
    const towardsDue = onCredit
        ? (await Order_1.Order.aggregate([{ $match: { eventId: event._id, kind: 'EVENT_BILL', status: Order_1.OrderStatus.PAID, forDue: true } }, { $group: { _id: null, invitees: { $sum: '$invitees' } } }]))[0]?.invitees || 0
        : 0;
    const owedOnCredit = Math.max(0, Math.min(onCredit - towardsDue, billed.size));
    return { rate: rate && rate > 0 ? rate : null, billed, sent: billed.size, covered, owedOnCredit, paidAmount: round2(paid[0]?.amount || 0) };
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
    const credit = Math.max(0, st.covered - (st.sent - st.owedOnCredit));
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
        currency: currency_1.PLATFORM_CURRENCY,
        // Pay Later: the amount due is to be paid by the event's end
        ...(event.payLater?.setAt && dueInvitees > 0 ? { payBy: event.schedule?.end, overdue: new Date(event.schedule?.end).getTime() < Date.now() } : {})
    };
}
/** Everything owed on an event now, plus what inviting these further guests would add */
async function owedWith(event, inviteeIds) {
    const st = await eventState(event);
    if (!st.rate)
        return { rate: null, invitees: 0 };
    const waiting = whatsapp_service_1.whatsappService.isConfigured() ? [...new Set([...(event.paymentRequest?.inviteeIds || []).map(String), ...inviteeIds])] : [];
    const further = waiting.length ? (await billableFor(event, waiting, 'WHATSAPP', st)).billable : 0;
    return { rate: st.rate, invitees: Math.max(0, st.sent - st.covered) + further };
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
            .select('title schedule createdAt pricing organizerId status paymentRequest payLater')
            .sort({ 'schedule.start': -1 })
            .lean();
        // a cancelled event has nothing left to pay, except what was sent on Pay Later; its past payments still count below
        const events = all.filter((e) => e.status !== 'CANCELLED' || e.payLater?.setAt);
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
        // an administrator also sees everything owed so far with these guests, which is what an offline payment settles
        let admin = {};
        if (!organizerId && purpose === 'WHATSAPP') {
            const owed = await owedWith(event, inviteeIds);
            admin = { owed: priceFor(owed.invitees, owed.rate ?? 0, gst), payBy: event.schedule?.end, payLater: !!event.payLater?.setAt };
        }
        return {
            ...price, rate: b.rate, selected: b.toSend, alreadyPaid: Math.min(b.toSend, b.credit), payable: b.rate !== null && b.billable > 0,
            free: purpose === 'EMAIL', whatsappUnavailable, organizerName: owner?.profile?.organizationName || owner?.fullName || 'The organizer', ...admin
        };
    },
    /** What is owed on the event now (nothing further), with the amounts */
    async amountDue(event) {
        const bill = await eventBill(event, await platformSettings_service_1.platformSettingsService.gstPercent());
        return { invitees: bill.dueInvitees, total: bill.due, currency: bill.currency };
    },
    /**
     * Pay Later: an administrator lets these guests be invited on WhatsApp now; the organizer pays by the event's end. Recorded before the
     * messages go, so nothing sent this way is ever left without its deadline.
     */
    async deferPayment(event, inviteeIds, adminId) {
        if (!whatsapp_service_1.whatsappService.isConfigured())
            return;
        const st = await eventState(event);
        if (!st.rate)
            return;
        const fresh = inviteeIds.filter((id) => !st.billed.has(String(id)));
        const b = await billableFor(event, fresh, 'WHATSAPP', st);
        if (b.billable <= 0)
            return;
        const first = !event.payLater?.setAt;
        await Event_1.Event.updateOne({ _id: event._id }, 
        // only as many as are really on credit: any that an earlier payment still covers are not
        { $addToSet: { 'payLater.inviteeIds': { $each: fresh.slice(0, b.billable) } }, ...(first ? { $set: { 'payLater.setBy': adminId, 'payLater.setAt': new Date() } } : {}) }, { timestamps: false });
        const price = priceFor(b.billable, st.rate, await platformSettings_service_1.platformSettingsService.gstPercent());
        await alert_service_1.alertService.notifyUser(event.organizerId, {
            type: 'PAYMENT', title: 'Pay later for WhatsApp invitations',
            message: `${b.billable} WhatsApp invitation${b.billable === 1 ? ' is' : 's are'} being sent for "${event.title}" (${price.currency} ${price.total.toFixed(2)}, including GST). Please pay from your Billing page before ${(0, deadline_1.deadlineLabel)(event.schedule?.end)}.`,
            entityType: 'Event', entityId: event._id
        });
    },
    /** Guests about to be invited on a paid send are no longer counted as invited on credit */
    async endDeferral(event, inviteeIds) {
        if (!event.payLater?.setAt)
            return;
        const billed = (await billedGuestsByEvent([event._id])).get(String(event._id)) ?? new Set();
        const paidNow = inviteeIds.filter((id) => !billed.has(String(id)));
        if (paidNow.length)
            await Event_1.Event.updateOne({ _id: event._id }, { $pull: { 'payLater.inviteeIds': { $in: paidNow.map((id) => new mongoose_1.default.Types.ObjectId(id)) } } }, { timestamps: false });
    },
    /**
     * Payment Settled: the organizer paid the administrator outside the platform. Records a paid bill for everything owed so far, including
     * the guests about to be invited; guests added later are new dues. It appears on the organizer's Billing as an offline payment.
     */
    async settleOffline(adminId, eventId, inviteeIds, note) {
        const lockedAt = new Date();
        const event = await Event_1.Event.findOneAndUpdate({ _id: eventId, $or: [{ settlingAt: null }, { settlingAt: { $lt: new Date(lockedAt.getTime() - 30_000) } }] }, { $set: { settlingAt: lockedAt } }, { new: true, timestamps: false }).lean();
        if (!event) {
            if (await Event_1.Event.exists({ _id: eventId }))
                throw new Error('SETTLEMENT_IN_PROGRESS');
            throw new Error('EVENT_NOT_FOUND');
        }
        try {
            const gst = await platformSettings_service_1.platformSettingsService.gstPercent();
            const owed = await owedWith(event, inviteeIds);
            if (owed.rate === null)
                throw new Error('RATE_NOT_SET');
            if (owed.invitees <= 0)
                throw new Error('NOTHING_DUE');
            const price = priceFor(owed.invitees, owed.rate, gst);
            const reference = `offline_${new mongoose_1.default.Types.ObjectId()}`;
            const order = await order_repository_1.orderRepository.create({
                kind: 'EVENT_BILL', userId: event.organizerId, eventId: event._id, quantity: 1, invitees: owed.invitees,
                amount: price.total, subtotal: price.subtotal, tax: price.tax, gstPercent: gst, currency: currency_1.PLATFORM_CURRENCY,
                providerOrderId: reference, status: Order_1.OrderStatus.PAID, forDue: true, settledBy: adminId, note: note || undefined
            });
            const payment = await payment_repository_1.paymentRepository.create({
                orderId: order._id, userId: event.organizerId, eventId: event._id, provider: 'OFFLINE', providerOrderId: reference,
                amountBase: price.subtotal, taxAmount: price.tax, totalAmount: price.total, currency: currency_1.PLATFORM_CURRENCY,
                status: Payment_1.PaymentStatus.PAID, signatureVerified: false
            });
            const invoiceNumber = `INV-${Date.now()}-${crypto_1.default.randomInt(1000, 10000)}`;
            await invoice_repository_1.invoiceRepository.create({
                invoiceNumber, eventName: event.title, paymentId: payment._id, userId: event.organizerId, eventId: event._id,
                invitees: owed.invitees, subtotal: price.subtotal, tax: price.tax, total: price.total,
                paymentMethod: 'OFFLINE', paymentStatus: 'PAID', issuedAt: new Date()
            });
            await Event_1.Event.updateOne({ _id: event._id }, { $unset: { paymentRequest: 1 } }, { timestamps: false });
            await alert_service_1.alertService.notifyUser(event.organizerId, {
                type: 'PAYMENT', title: 'Payment recorded',
                message: `Your payment of ${price.currency} ${price.total.toFixed(2)} for "${event.title}" was recorded by the administrator (invoice ${invoiceNumber}).`,
                entityType: 'Event', entityId: event._id
            });
            return { ...price, invoiceNumber };
        }
        finally {
            await Event_1.Event.updateOne({ _id: event._id, settlingAt: lockedAt }, { $unset: { settlingAt: 1 } }, { timestamps: false });
        }
    },
    /** Is money still owed for invitations sent on Pay Later? Such an event is not deleted or purged: that would erase the bill. */
    async hasUnpaidPayLater(eventId) {
        const event = await Event_1.Event.findById(eventId).lean();
        if (!event?.payLater?.setAt)
            return false;
        return (await this.amountDue(event)).invitees > 0;
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
        const forDue = !(inviteeIds && inviteeIds.length);
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
            forDue,
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
            currency: currency_1.PLATFORM_CURRENCY,
            /** true for money the administrator received outside the platform */
            offline: i.paymentMethod === 'OFFLINE'
        }));
    }
};
