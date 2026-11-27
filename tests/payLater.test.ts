// An administrator's three ways of handling an organizer's WhatsApp bill: Pay Now (request), Pay Later (send now, pay by the event's
// end, with reminders) and Payment Settled (paid outside the platform). Razorpay, WhatsApp and email are stubbed.
import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Category } from '../src/models/Category';
import { Event } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { Invitation } from '../src/models/Invitation';
import { Order } from '../src/models/Order';
import { Invoice } from '../src/models/Invoice';
import { Notification } from '../src/models/Notification';
import { PlatformSettings } from '../src/models/PlatformSettings';
import { whatsappService } from '../src/services/whatsapp.service';
import { billingService } from '../src/services/billing.service';
import { paymentReminderService } from '../src/services/paymentReminder.service';
import { sendEmail } from '../src/utils/email.provider';
import { generateAccessToken } from '../src/utils/token';

jest.mock('../src/utils/email.provider', () => ({ sendEmail: jest.fn().mockResolvedValue(true), publicApiUrl: () => undefined }));
jest.setTimeout(120_000);

const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });
const mail = sendEmail as jest.Mock;
const day = 864e5, hour = 36e5;
let mongo: MongoMemoryServer, org: any, admin: any, ev: any, n = 0;
let sendSpy: jest.SpyInstance;

const guests = async (count: number) => (await Invitee.insertMany(Array.from({ length: count }, () => { n += 1; return { eventId: ev._id, name: `Guest ${n}`, email: `g${n}@x.com`, mobile: `98${String(10000000 + n)}` }; }))).map((g: any) => String(g._id));
const send = (who: any, ids: string[], extra: object = {}) => request(app).post(`/api/v1/events/${ev._id}/invitations/send`).set(auth(who)).send({ inviteeIds: ids, channel: 'WHATSAPP', ...extra });
const bill = async () => (await request(app).get('/api/v1/billing/events').set(auth(org))).body.data.events[0];
const quote = async (who: any, ids: string[]) => (await request(app).post('/api/v1/billing/quote').set(auth(who)).send({ eventId: String(ev._id), inviteeIds: ids, channel: 'WHATSAPP' })).body.data;
const settle = (who: any, body: object) => request(app).post('/api/v1/billing/settle').set(auth(who)).send({ eventId: String(ev._id), ...body });
const pay = async (ids?: string[]) => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_u: any, init: any) => ({ ok: true, json: async () => ({ id: `order_pl_${++n}`, amount: JSON.parse(init.body).amount, currency: 'INR' }) }) as any);
  const started = await request(app).post('/api/v1/billing/pay').set(auth(org)).send({ eventId: String(ev._id), ...(ids ? { inviteeIds: ids, channel: 'WHATSAPP' } : {}) });
  fetchSpy.mockRestore();
  expect(started.status).toBe(201);
  const o = started.body.data.providerOrderId;
  const signature = crypto.createHmac('sha256', 'rzp_test_secret').update(`${o}|pay_${n}`).digest('hex');
  expect((await request(app).post('/api/v1/payments/verify').set(auth(org)).send({ providerOrderId: o, providerPaymentId: `pay_${n}`, signature })).status).toBe(200);
  return started.body.data;
};
const endsIn = (ms: number) => Event.updateOne({ _id: ev._id }, { $set: { 'schedule.start': new Date(Date.now() + ms - hour), 'schedule.end': new Date(Date.now() + ms) } });

beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  await Promise.all([User, Category, Event, Invitee, Invitation, Order, Invoice, Notification, PlatformSettings].map((m: any) => m.deleteMany({})));
  org = await User.create({ fullName: 'Asha Org', email: 'asha@x.com', phone: '919800000001', role: Role.ORGANIZER, isActive: true });
  admin = await User.create({ fullName: 'Admin', email: 'root@x.com', role: Role.ADMIN, isActive: true });
  const cat = await Category.create({ name: 'Corporate', isActive: true });
  ev = await Event.create({ organizerId: org._id, title: 'Summit', description: 'd', categoryId: cat._id, format: 'PHYSICAL', status: 'PUBLISHED', contactNumber: '9007000891', location: { address: 'Kolkata' }, schedule: { start: new Date(Date.now() + 10 * day), end: new Date(Date.now() + 10 * day + hour) }, pricing: { ratePerInvitee: 3, currency: 'INR', lockedAt: new Date() } });
  sendSpy = jest.spyOn(whatsappService, 'sendInvitationWhatsApp').mockResolvedValue({ messageId: 'wamid.ok', mediaId: 'media.ok' });
  mail.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('Pay Later', () => {
  it('lets the administrator send without payment, and shows it due by the event\'s end', async () => {
    const ids = await guests(3);
    expect((await send(admin, ids)).status).toBe(402);
    expect((await send(admin, ids, { payLater: true })).status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(3);
    const row = await bill();
    expect(row).toMatchObject({ invitesSent: 3, dueInvitees: 3, due: 10.62, overdue: false });
    expect(new Date(row.payBy).getTime()).toBe(new Date((await Event.findById(ev._id).lean() as any).schedule.end).getTime());
    expect(await Notification.countDocuments({ userId: org._id, type: 'PAYMENT', title: 'Pay later for WhatsApp invitations' })).toBe(1);
  });

  it('is the administrator\'s choice only', async () => {
    const ids = await guests(1);
    expect((await send(org, ids, { payLater: true })).status).toBe(403);
    expect(sendSpy).not.toHaveBeenCalled();
    expect((await Event.findById(ev._id).lean() as any).payLater?.setAt).toBeUndefined();
  });

  it('keeps the debt apart from a payment for new guests, and clears it when the due is paid', async () => {
    const first = await guests(5);
    await send(admin, first, { payLater: true });
    const more = await guests(3);
    expect((await send(org, more)).status).toBe(402);
    expect(await quote(org, more)).toMatchObject({ invitees: 3, total: 10.62 });
    await pay(more);
    expect((await send(org, more)).status).toBe(200);
    expect(await bill()).toMatchObject({ invitesSent: 8, dueInvitees: 5 });
    await pay();
    const row = await bill();
    expect(row).toMatchObject({ dueInvitees: 0, due: 0 });
    expect(row.payBy).toBeUndefined();
    // nothing is left over: the next guest is charged
    expect(await quote(org, await guests(1))).toMatchObject({ invitees: 1, payable: true });
  });

  it('puts on credit only what an earlier payment does not cover', async () => {
    await pay(await guests(2));
    await send(admin, await guests(5), { payLater: true });
    expect(await bill()).toMatchObject({ invitesSent: 5, dueInvitees: 3 });
    expect(await quote(org, await guests(2))).toMatchObject({ invitees: 2, alreadyPaid: 0 });
  });

  it('is not escaped by cancelling or deleting the event', async () => {
    await send(admin, await guests(2), { payLater: true });
    await Event.updateOne({ _id: ev._id }, { $set: { status: 'CANCELLED' } });
    expect(await bill()).toMatchObject({ dueInvitees: 2 });
    const refused = await request(app).post(`/api/v1/events/${ev._id}/delete`).set(auth(org)).send({ confirmTitle: 'Summit' });
    expect([refused.status, refused.body.code]).toEqual([409, 'PAYMENT_PENDING']);
    expect(await billingService.hasUnpaidPayLater(ev._id)).toBe(true);
    await pay();
    expect(await billingService.hasUnpaidPayLater(ev._id)).toBe(false);
  });
});

describe('Payment Settled', () => {
  it('records everything owed so far with the guests about to be invited, then lets them go', async () => {
    const earlier = await guests(2);
    await send(admin, earlier, { payLater: true });
    const now = await guests(3);
    expect(await quote(admin, now)).toMatchObject({ invitees: 3, owed: { invitees: 5, total: 17.7 }, payLater: true });
    // asked with no further guests (the reminder shown on the event): what is already owed
    expect(await quote(admin, [])).toMatchObject({ invitees: 0, owed: { invitees: 2, total: 7.08 }, payLater: true });
    expect(await quote(org, now)).not.toHaveProperty('owed');
    const done = await settle(admin, { inviteeIds: now, note: 'Cash, receipt 14' });
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ invitees: 5, total: 17.7 });
    expect(await Order.findOne({ eventId: ev._id }).lean()).toMatchObject({ status: 'PAID', invitees: 5, forDue: true, note: 'Cash, receipt 14' });
    const invoices = (await request(app).get('/api/v1/billing/invoices').set(auth(org))).body.data;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amount: 17.7, invitees: 5, offline: true });
    expect((await send(admin, now)).status).toBe(200);
    expect(await bill()).toMatchObject({ dueInvitees: 0, paid: 17.7 });
    // guests added later are new dues
    expect((await send(admin, await guests(1))).status).toBe(402);
  });

  it('is for administrators, once: nothing is recorded twice or when nothing is owed', async () => {
    const ids = await guests(2);
    expect((await settle(org, { inviteeIds: ids })).status).toBe(403);
    const attempt = () => billingService.settleOffline(String(admin._id), String(ev._id), ids).then(() => 'RECORDED', (e: Error) => e.message);
    const both = await Promise.all([attempt(), attempt()]);
    expect(both.filter((r) => r === 'RECORDED')).toHaveLength(1);
    expect(['SETTLEMENT_IN_PROGRESS', 'NOTHING_DUE']).toContain(both.find((r) => r !== 'RECORDED'));
    expect(await Order.countDocuments({ eventId: ev._id })).toBe(1);
    expect((await settle(admin, { inviteeIds: ids })).body.message).toMatch(/Nothing is due/);
    expect((await settle(admin, { note: 'x'.repeat(301) })).status).toBe(400);
  });
});

describe('Pay Later reminders', () => {
  const subjects = () => mail.mock.calls.filter(([to]) => to === 'asha@x.com').map(([, subject]) => subject);

  it('go 3 days and 1 day before the end, then once as overdue to the organizer and the administrator', async () => {
    await send(admin, await guests(2), { payLater: true });
    mail.mockClear();
    const reminder = jest.spyOn(whatsappService, 'sendPaymentReminder').mockResolvedValue({ messageId: 'w' });
    expect(await paymentReminderService.sweep()).toBe(0); // ten days to go
    await endsIn(2.5 * day);
    expect(await paymentReminderService.sweep()).toBe(1);
    expect(await paymentReminderService.sweep()).toBe(0);
    await endsIn(20 * hour);
    expect(await paymentReminderService.sweep()).toBe(1);
    expect(await paymentReminderService.sweep()).toBe(0);
    await endsIn(-hour);
    expect(await paymentReminderService.sweep()).toBe(1);
    expect(await paymentReminderService.sweep()).toBe(0);
    expect(subjects()).toEqual(['Payment due soon for "Summit"', 'Payment due tomorrow for "Summit"', 'Payment overdue for "Summit"']);
    expect(mail.mock.calls.some(([to, subject]) => to === 'root@x.com' && subject === 'Overdue payment: Summit')).toBe(true);
    expect(mail.mock.calls[0][2]).toMatch(/INR 7\.08/);
    expect(reminder).toHaveBeenCalledTimes(3);
    expect(reminder.mock.calls[2][0]).toMatchObject({ overdue: true, recipientPhone: '919800000001', amount: 'INR 7.08' });
    expect(await Notification.countDocuments({ userId: admin._id, type: 'PAYMENT' })).toBe(1);
    expect((await bill()).overdue).toBe(true);
  });

  it('do not go once paid or settled, and a stage already overtaken is not sent late', async () => {
    await send(admin, await guests(1), { payLater: true });
    await endsIn(10 * hour);
    mail.mockClear();
    expect(await paymentReminderService.sweep()).toBe(1);
    expect(subjects()).toEqual(['Payment due tomorrow for "Summit"']);
    await settle(admin, {});
    await endsIn(-hour);
    mail.mockClear();
    expect(await paymentReminderService.sweep()).toBe(0);
    expect(mail).not.toHaveBeenCalled();
  });

  it('go by email when no WhatsApp template is set up', async () => {
    await send(admin, await guests(1), { payLater: true });
    await endsIn(2 * day);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mail.mockClear();
    expect(await paymentReminderService.sweep()).toBe(1);
    expect(subjects()).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
