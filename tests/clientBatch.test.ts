/**
 * A round of client changes: deleting categories, deleting from one session, erasing an organizer, the price rate reaching events with
 * nothing sent, separate in-app and email alert switches, verification of organizers an administrator creates, food preference limits and
 * administrator-uploaded cards while only the built-in shared designs are otherwise offered.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import xlsx from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Event, EventFormat, EventStatus } from '../src/models/Event';
import { Session, AccessControl, InviteeSource } from '../src/models/Session';
import { Invitee } from '../src/models/Invitee';
import { InviteeSet } from '../src/models/InviteeSet';
import { Invitation } from '../src/models/Invitation';
import { CheckIn } from '../src/models/CheckIn';
import { Category } from '../src/models/Category';
import { Template } from '../src/models/Template';
import { Media, MediaPurpose } from '../src/models/Media';
import { Notification } from '../src/models/Notification';
import { SystemUserAssignment } from '../src/models/SystemUserAssignment';
import { PlatformSettings } from '../src/models/PlatformSettings';
import { VerificationCode } from '../src/models/VerificationCode';
import { AuditLog } from '../src/models/AuditLog';
import { generateAccessToken } from '../src/utils/token';
import { smsService } from '../src/services/sms.service';
import { alertService } from '../src/services/alert.service';
import { inviteeAllowedInSession } from '../src/utils/sessionAccess';
import { withGuests } from './helpers/withGuests';

const mockSendEmail = jest.fn().mockResolvedValue(true);
jest.mock('../src/utils/email.provider', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }));

jest.setTimeout(120_000);
let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });
const person = (role: Role, name: string, extra: Record<string, unknown> = {}) =>
  User.create({ fullName: name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@batch.test`, role, isActive: true, passwordHash: 'x', ...extra });
const inDays = (n: number) => new Date(Date.now() + n * 86400000);
const makeEvent = (organizer: any, extra: Record<string, unknown> = {}) => Event.create({
  organizerId: organizer._id, title: 'Gala', description: 'd', categoryId: new mongoose.Types.ObjectId(), format: EventFormat.PHYSICAL,
  schedule: { start: inDays(2), end: inDays(3) }, status: EventStatus.PUBLISHED, ...extra
});

let admin: any, org: any, other: any;
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  mockSendEmail.mockClear();
  jest.restoreAllMocks();
  admin = await person(Role.ADMIN, 'Admin');
  org = await person(Role.ORGANIZER, 'Org');
  other = await person(Role.ORGANIZER, 'Other');
});

describe('an administrator deletes a category or subcategory', () => {
  let category: any;
  beforeEach(async () => {
    category = await Category.create({ name: 'Festive', isActive: true, subcategories: [{ name: 'Puja' }, { name: 'Fair' }] });
  });
  const list = async (as: any) => (await request(app).get('/api/v1/categories').set(auth(as))).body.data;
  const newEvent = (body: object) => request(app).post('/api/v1/events').set(auth(org)).send({ title: 'New', description: 'd', format: 'PHYSICAL', location: { address: 'x' }, schedule: { start: inDays(2).toISOString(), end: inDays(3).toISOString() }, ...body });

  it('a subcategory: not offered for new events, its templates stay in the category, adding the name again brings it back', async () => {
    const puja = category.subcategories[0]._id;
    const tpl = await Template.create({ name: 'T', categoryId: category._id, subcategoryId: puja });
    const event = await makeEvent(org, { categoryId: category._id, subcategoryId: puja });
    expect((await request(app).delete(`/api/v1/categories/${category._id}/subcategories/${puja}`).set(auth(org))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/categories/${category._id}/subcategories/${puja}`).set(auth(admin))).status).toBe(200);
    expect((await list(admin))[0].subcategories.filter((s: any) => s.isActive !== false).map((s: any) => s.name)).toEqual(['Fair']);
    expect((await newEvent({ categoryId: String(category._id), subcategoryId: String(puja) })).status).toBe(400);
    expect(String((await Event.findById(event._id))!.subcategoryId)).toBe(String(puja)); // the event keeps it
    const after: any = await Template.findById(tpl._id).lean();
    expect([String(after.categoryId), after.subcategoryId]).toEqual([String(category._id), undefined]);
    expect((await request(app).delete(`/api/v1/categories/${category._id}/subcategories/${puja}`).set(auth(admin))).status).toBe(404);
    const again = await request(app).post(`/api/v1/categories/${category._id}/subcategories`).set(auth(admin)).send({ name: 'puja' });
    expect(again.status).toBe(201);
    expect(again.body.data.subcategories).toHaveLength(2);
    expect(String(again.body.data.subcategories.find((s: any) => s.name === 'puja')._id)).toBe(String(puja));
  });

  it('a category: gone from the list, refused for new events, its templates become general, and the name can come back', async () => {
    const tpl = await Template.create({ name: 'T', categoryId: category._id });
    expect((await request(app).delete(`/api/v1/categories/${category._id}`).set(auth(org))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/categories/${category._id}`).set(auth(admin))).status).toBe(200);
    expect(await list(org)).toEqual([]);
    expect((await newEvent({ categoryId: String(category._id) })).status).toBe(400);
    expect((await Template.findById(tpl._id).lean())!.categoryId).toBeUndefined();
    const again = await request(app).post('/api/v1/categories').set(auth(admin)).send({ name: 'Festive' });
    expect(again.status).toBe(201);
    expect(String(again.body.data._id)).toBe(String(category._id));
  });
});

describe('deleting with a session chosen removes guests from that session only', () => {
  let event: any, lunch: any, dinner: any, bar: any;
  const session = (name: string, extra: Record<string, unknown> = {}) => Session.create({ eventId: event._id, name, schedule: event.schedule, accessControl: AccessControl.ONLY_ONCE, validateAgainstOtherSessions: false, inviteeSource: InviteeSource.NEW_LIST, ...extra });
  const guest = (name: string, access: Array<[any, boolean]> = [], extra: Record<string, unknown> = {}) => Invitee.create({ eventId: event._id, name, email: `${name.toLowerCase()}@g.test`, sessionAccess: access.map(([s, allowed]) => ({ sessionId: s._id, allowed })), ...extra });
  const remove = (from: any, guests: any[], as = org) => request(app).post(`/api/v1/events/${event._id}/invitees/session-access/remove`).set(auth(as)).send({ sessionId: String(from._id), inviteeIds: guests.map((g) => String(g._id)) });
  const attends = async (g: any) => {
    const fresh: any = await Invitee.findById(g._id).lean();
    const all = await Session.find({ eventId: event._id }).sort({ _id: 1 });
    return all.filter((s) => inviteeAllowedInSession(fresh, s as any)).map((s) => s.name);
  };
  beforeEach(async () => {
    event = await makeEvent(org);
    lunch = await session('Lunch');
    dinner = await session('Dinner');
  });

  it('a guest in every session leaves only the chosen one; a guest only in it is reported, not touched', async () => {
    bar = await session('Bar');
    const everyone = await guest('Everyone');
    const both = await guest('Both', [[lunch, true], [dinner, true]]);
    const only = await guest('Only', [[lunch, true]]);
    const outside = await guest('Outside', [[dinner, true]]);
    const res = await remove(lunch, [everyone, both, only, outside]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: 2, onlyThisSession: [String(only._id)], notInSession: 1 });
    expect(await attends(everyone)).toEqual(['Dinner', 'Bar']);
    expect(await attends(both)).toEqual(['Dinner']);
    expect(await attends(only)).toEqual(['Lunch']);
    expect(await attends(outside)).toEqual(['Dinner']);
    expect(await Invitee.countDocuments({ eventId: event._id })).toBe(4);
  });

  it('removing from a session that keeps another session\'s invitees leaves the source session as it was', async () => {
    const copy = await session('After party', { inviteeSource: InviteeSource.COPY_SESSION, sourceSessionId: lunch._id });
    const a = await guest('Asha', [[lunch, true], [dinner, true]]);
    const b = await guest('Bina', [[lunch, true]]);
    expect(await attends(b)).toEqual(['Lunch', 'After party']);
    const res = await remove(copy, [a, b]);
    expect(res.body.data).toMatchObject({ removed: 2, onlyThisSession: [] });
    expect(await attends(a)).toEqual(['Lunch', 'Dinner']);
    expect(await attends(b)).toEqual(['Lunch']);
    expect(await Session.findById(copy._id).lean()).toMatchObject({ inviteeSource: 'NEW_LIST', sourceSessionId: null });
  });

  it('removing from the source of a shared list leaves the sessions that copied it as they were', async () => {
    const copy = await session('After party', { inviteeSource: InviteeSource.COPY_SESSION, sourceSessionId: lunch._id });
    const a = await guest('Asha', [[lunch, true]]);
    const b = await guest('Bina', [[lunch, true], [dinner, true]]);
    const res = await remove(lunch, [a]);
    expect(res.body.data).toMatchObject({ removed: 1 });
    expect(await attends(a)).toEqual(['After party']);
    expect(await attends(b)).toEqual(['Lunch', 'Dinner', 'After party']);
    expect(await Session.findById(copy._id).lean()).toMatchObject({ inviteeSource: 'NEW_LIST' });
  });

  it('the uploaded list of that session no longer shows the guest, who stays in the others', async () => {
    const set = await InviteeSet.create({ eventId: event._id, sessionId: lunch._id, name: 'l.xlsx', mode: 'APPEND', createdBy: org._id, createdByRole: 'ORGANIZER' });
    const a = await guest('Asha', [[lunch, true], [dinner, true]], { inviteeSetId: set._id });
    await remove(lunch, [a]);
    const sets = (await request(app).get(`/api/v1/events/${event._id}/invitees/sets`).set(auth(org))).body.data;
    expect(sets.sets.find((s: any) => s.id === String(set._id))).toMatchObject({ total: 0 });
    expect(sets.totalGuests).toBe(1);
    const members = (await request(app).get(`/api/v1/events/${event._id}/invitees/sets/${set._id}/members`).set(auth(org))).body.data;
    expect(members.total).toBe(0);
  });

  it('is only for the event\'s organizer or an administrator', async () => {
    const a = await guest('Asha');
    expect((await remove(lunch, [a], other)).status).toBe(404);
    expect((await remove(lunch, [a], admin)).status).toBe(200);
  });
});

describe('an administrator deletes an organizer permanently', () => {
  it('shows what will go, needs confirmation, erases it all and leaves everyone else alone', async () => {
    const event = await makeEvent(org);
    const theirs = await makeEvent(other);
    const lunch = await Session.create({ eventId: event._id, name: 'L', schedule: event.schedule, accessControl: AccessControl.ONLY_ONCE, validateAgainstOtherSessions: false, inviteeSource: InviteeSource.NEW_LIST });
    const g = await Invitee.create({ eventId: event._id, name: 'Guest', email: 'g@g.test' });
    await Invitee.create({ eventId: theirs._id, name: 'Keep', email: 'k@g.test' });
    await CheckIn.create({ eventId: event._id, inviteeId: g._id, sessionId: lunch._id, checkInMethod: 'QR', checkedInBy: org._id });
    const mine = await person(Role.SYSTEM_USER, 'Mine', { createdBy: org._id });
    const shared = await person(Role.SYSTEM_USER, 'Shared', { createdBy: org._id });
    await SystemUserAssignment.create({ userId: mine._id, eventId: event._id, sessionIds: [], assignedBy: org._id });
    await SystemUserAssignment.create({ userId: shared._id, eventId: theirs._id, sessionIds: [], assignedBy: other._id });
    await Category.create({ name: 'Own', ownerId: org._id });
    const platform = await Category.create({ name: 'Platform', subcategories: [{ name: 'Mine', ownerId: org._id }, { name: 'All' }] });
    await Template.create({ name: 'Mine', ownerId: org._id, cardDesign: 'CUSTOM', isSystemTemplate: false });
    await Notification.create({ userId: org._id, type: 'X', title: 't', message: 'm' });

    expect((await request(app).get(`/api/users/${org._id}/erase-summary`).set(auth(other))).status).toBe(403);
    const summary = (await request(app).get(`/api/users/${org._id}/erase-summary`).set(auth(admin))).body.data;
    expect(summary).toMatchObject({ events: 1, openEvents: 1, invitees: 1, checkIns: 1, systemUsers: 1, templates: 1, amountDue: 0 });
    expect((await request(app).post(`/api/users/${org._id}/erase`).set(auth(admin)).send({})).status).toBe(400);
    expect(await User.countDocuments({ _id: org._id })).toBe(1);

    const done = await request(app).post(`/api/users/${org._id}/erase`).set(auth(admin)).send({ confirm: true });
    expect(done.status).toBe(200);
    expect(await User.countDocuments({ _id: { $in: [org._id, mine._id] } })).toBe(0);
    for (const model of [Session, CheckIn] as any[]) expect(await model.countDocuments({ eventId: event._id })).toBe(0);
    expect(await Invitee.countDocuments({})).toBe(1);
    expect(await Event.countDocuments({})).toBe(1);
    expect(await Category.countDocuments({ ownerId: org._id })).toBe(0);
    expect((await Category.findById(platform._id).lean())!.subcategories.map((s: any) => s.name)).toEqual(['All']);
    expect(await Template.countDocuments({ ownerId: org._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: org._id })).toBe(0);
    expect(await User.countDocuments({ _id: { $in: [shared._id, other._id, admin._id] } })).toBe(3);
    expect(await AuditLog.countDocuments({ action: 'ORGANIZER_ERASED' })).toBe(1);
    expect((await request(app).post(`/api/users/${org._id}/erase`).set(auth(admin)).send({ confirm: true })).status).toBe(404);
    expect((await request(app).post(`/api/users/${admin._id}/erase`).set(auth(admin)).send({ confirm: true })).status).toBe(404);
  });

  it('a deactivated organizer can be activated again', async () => {
    expect((await request(app).patch(`/api/users/${org._id}`).set(auth(admin)).send({ isActive: false })).status).toBe(200);
    expect((await User.findById(org._id))!.isActive).toBe(false);
    expect((await request(app).patch(`/api/users/${org._id}`).set(auth(admin)).send({ isActive: true })).status).toBe(200);
    expect((await User.findById(org._id))!.isActive).toBe(true);
  });
});

describe('a new price rate reaches the events nothing has been sent for', () => {
  const priced = (organizer: any, extra: Record<string, unknown> = {}) => makeEvent(organizer, { pricing: { ratePerInvitee: 3, currency: 'INR', lockedAt: new Date() }, ...extra });
  const save = (rate: number) => request(app).put('/api/v1/settings/pricing').set(auth(admin)).send({ ratePerInvitee: rate });
  const rateOf = async (e: any) => (await Event.findById(e._id).lean())!.pricing!.ratePerInvitee;

  it('unsent events take it; sent, paid-later and own-rate events keep theirs; saving it again catches up', async () => {
    const unsent = await priced(org);
    const sent = await priced(org);
    const g = await Invitee.create({ eventId: sent._id, name: 'G', email: 'g@g.test', invitationStatus: 'SENT' });
    await Invitation.create({ eventId: sent._id, inviteeId: g._id, channel: 'EMAIL', status: 'SENT', tokenHash: 'h' } as any);
    const owed = await priced(org, { payLater: { setAt: new Date() } });
    await User.updateOne({ _id: other._id }, { customRatePerInvitee: 5 });
    const own = await priced(other);
    const before = (await Event.findById(unsent._id))!.get('updatedAt');

    expect((await save(15)).status).toBe(200);
    expect([await rateOf(unsent), await rateOf(sent), await rateOf(owed), await rateOf(own)]).toEqual([15, 3, 3, 3]);
    expect((await Event.findById(unsent._id))!.get('updatedAt')).toEqual(before);
    const earnings = (await request(app).get('/api/v1/reports/earnings').set(auth(admin))).body.data;
    const shown = Object.fromEntries(earnings.events.map((e: any) => [e.eventId, e.ratePerInvitee]));
    expect([shown[String(unsent._id)], shown[String(sent._id)], shown[String(own._id)]]).toEqual([15, 3, 5]);

    const late = await priced(org);
    expect((await save(15)).status).toBe(200);
    expect(await rateOf(late)).toBe(15);

    // back on the platform rate: that organizer's unsent events take it
    await request(app).put(`/api/users/${other._id}/rate`).set(auth(admin)).send({ ratePerInvitee: null });
    expect(await rateOf(own)).toBe(15);
  });
});

describe('in-app and email alerts are switched separately', () => {
  const put = (path: string, body: object) => request(app).put(`/api/v1/settings/${path}`).set(auth(admin)).send(body);
  const get = async (path: string) => (await request(app).get(`/api/v1/settings/${path}`).set(auth(admin))).body.data;
  const alert = async () => {
    mockSendEmail.mockClear();
    await Notification.deleteMany({});
    await alertService.notifyAdmins('newEventAdded', { type: 'EVENT', title: 't', message: 'm' });
    await new Promise((r) => setImmediate(r));
    return [await Notification.countDocuments({ userId: admin._id }), mockSendEmail.mock.calls.length];
  };

  it('in-app follows email until it is saved on its own, then each is independent', async () => {
    expect((await get('push-notifications')).newEventAdded).toBe(true);
    expect(await alert()).toEqual([1, 1]);
    await put('notifications', { newEventAdded: false });
    expect((await get('push-notifications')).newEventAdded).toBe(true); // changing email never moves the in-app choice
    expect(await alert()).toEqual([1, 0]);
    await put('push-notifications', { newEventAdded: false });
    expect(await alert()).toEqual([0, 0]);
    await put('notifications', { newEventAdded: true });
    expect(await alert()).toEqual([0, 1]);
    expect((await request(app).put('/api/v1/settings/push-notifications').set(auth(org)).send({ newEventAdded: true })).status).toBe(403);
  });

  it('a choice made before the in-app switches existed is kept for both', async () => {
    await PlatformSettings.create({ key: 'global', notificationPreferences: { newEventAdded: false } });
    expect((await get('push-notifications')).newEventAdded).toBe(false);
  });
});

describe('an organizer created by an administrator verifies their account', () => {
  const texts: string[] = [];
  let smsOn = true;
  let made: any;
  const code = () => (mockSendEmail.mock.calls.at(-1)![2] as string).match(/>\s*(\d{6})\s*</)![1];
  const createEvent = (as: any) => request(app).post('/api/v1/events').set(auth(as)).send({ title: 'Mine', description: 'd', format: 'PHYSICAL', location: { address: 'x' }, schedule: { start: inDays(2).toISOString(), end: inDays(3).toISOString() } });
  const post = (path: string, body: object = {}) => request(app).post(`/api/users/${path}`).set(auth(made)).send(body);
  const pending = async () => (await request(app).get('/api/users/profile').set(auth(made))).body.data.verificationPending;
  beforeEach(async () => {
    smsOn = true;
    texts.length = 0;
    jest.spyOn(smsService, 'isConfigured').mockImplementation(() => smsOn);
    jest.spyOn(smsService, 'sendOtp').mockImplementation(async (_phone, c) => { texts.push(c); });
    await VerificationCode.syncIndexes();
    const res = await request(app).post('/api/users').set(auth(admin)).send({ fullName: 'New Org', email: 'new@batch.test', password: 'StrongPass123!', phone: '9876500011', role: 'ORGANIZER' });
    expect(res.status).toBe(201);
    made = await User.findOne({ email: 'new@batch.test' });
  });

  it('can sign in, but cannot create events or send until the email and mobile are verified', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'new@batch.test', password: 'StrongPass123!' })).status).toBe(200);
    expect(await pending()).toEqual({ email: true, phone: true });
    const refused = await createEvent(made);
    expect([refused.status, refused.body.code]).toEqual([403, 'VERIFICATION_REQUIRED']);
    expect(refused.body.message).toContain('email address and mobile number');
    const event = await makeEvent(made);
    expect((await request(app).post(`/api/v1/events/${event._id}/invitations/send`).set(auth(made)).send({ inviteeIds: [String(new mongoose.Types.ObjectId())], channel: 'EMAIL' })).body.code).toBe('VERIFICATION_REQUIRED');
    // an administrator working on their event is not stopped by it
    expect((await request(app).post(`/api/v1/events/${event._id}/invitations/send`).set(auth(admin)).send({ inviteeIds: [String(new mongoose.Types.ObjectId())], channel: 'EMAIL' })).body.code).not.toBe('VERIFICATION_REQUIRED');

    expect((await post('me/email/verify/send')).status).toBe(200);
    const right = code();
    expect((await post('me/email/verify/confirm', { code: right === '000000' ? '111111' : '000000' })).status).toBe(400);
    expect((await post('me/email/verify/confirm', { code: right })).status).toBe(200);
    expect(await pending()).toEqual({ email: false, phone: true });
    expect((await createEvent(made)).body.message).toContain('Verify your mobile number');
    expect((await post('me/phone/send')).status).toBe(200);
    expect((await post('me/phone/verify', { code: texts.at(-1) })).status).toBe(200);
    expect(await pending()).toBeNull();
    expect((await createEvent(made)).status).toBe(201);
  });

  it('the mobile number is not demanded while the server cannot send text messages', async () => {
    smsOn = false;
    expect(await pending()).toEqual({ email: true, phone: false });
    await post('me/email/verify/send');
    await post('me/email/verify/confirm', { code: code() });
    expect(await pending()).toBeNull();
    expect((await createEvent(made)).status).toBe(201);
  });

  it('a changed email address has to be verified again; accounts that existed or signed themselves up are not affected', async () => {
    await User.updateOne({ _id: made._id }, { emailConfirmedAt: new Date(), isPhoneVerified: true });
    expect(await pending()).toBeNull();
    await request(app).patch(`/api/users/${made._id}`).set(auth(admin)).send({ email: 'changed@batch.test' });
    expect(await pending()).toEqual({ email: true, phone: false });
    expect((await createEvent(org)).status).toBe(201);
  });
});

describe('food preference character limits', () => {
  const create = (dietaryPreference: object) => request(app).post('/api/v1/events').set(auth(org)).send({ title: 'Food', description: 'd', format: 'PHYSICAL', location: { address: 'x' }, schedule: { start: inDays(2).toISOString(), end: inDays(3).toISOString() }, dietaryPreference });
  it('refuses a long title or option and accepts one at the limit', async () => {
    expect((await create({ enabled: true, title: 't'.repeat(41), options: ['Veg'] })).status).toBe(400);
    expect((await create({ enabled: true, title: 'Meal', options: ['o'.repeat(31)] })).status).toBe(400);
    expect((await create({ enabled: true, options: [{ title: 't'.repeat(41), options: ['Veg'] }] })).status).toBe(400);
    expect((await create({ enabled: true, options: [{ title: 'Meal', options: ['o'.repeat(31)] }] })).status).toBe(400);
    expect((await create({ enabled: true, title: 't'.repeat(40), options: ['o'.repeat(30)] })).status).toBe(201);
  });
});

describe('a card an administrator uploads for everyone, while only the built-in shared designs are otherwise offered', () => {
  const before = process.env.MASTER_CARD_ONLY;
  beforeAll(() => { process.env.MASTER_CARD_ONLY = 'true'; });
  afterAll(() => { if (before === undefined) delete process.env.MASTER_CARD_ONLY; else process.env.MASTER_CARD_ONLY = before; });
  const buf = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };

  it('organizers see it, preview it, create events with it, and an administrator can download its marked areas', async () => {
    const data = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#f6c9d8"/></svg>')).png().toBuffer();
    const m = await Media.create({ ownerId: admin._id, purpose: MediaPurpose.TEMPLATE, contentType: 'image/png', size: data.length, width: 1080, height: 1920, data });
    const made = await request(app).post('/api/v1/templates/upload').set(auth(admin)).send({ publish: true, name: 'Pink', imageKey: `media:${m._id}` });
    expect(made.status).toBe(201);
    const id = made.body.data._id;
    expect((await request(app).get('/api/v1/templates').set(auth(org))).body.data.map((t: any) => t.name)).toContain('Pink');
    const preview = await request(app).post(`/api/v1/templates/${id}/preview`).set(auth(org)).send({ title: 'Hello' }).buffer(true).parse(buf);
    expect(preview.status).toBe(200);
    expect([...(await sharp(preview.body).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer())]).toEqual([0xf6, 0xc9, 0xd8]); // drawn on the upload, not on the master card
    const event = await request(app).post('/api/v1/events').set(auth(org)).send({ title: 'Pink party', description: 'd', format: 'PHYSICAL', location: { address: 'x' }, schedule: { start: inDays(2).toISOString(), end: inDays(3).toISOString() }, templateId: id });
    expect(event.status).toBe(201);
    expect(String((await Event.findById(event.body.data.eventId))!.templateId)).toBe(id);

    // the administrator who uploaded it downloads what the marked areas produce
    const second = await person(Role.ADMIN, 'Second Admin');
    const zones = [{ role: 'title', x: 130, y: 900, w: 820, h: 140, lines: 1, color: '#5a2030', fontFamily: 'Inter', fontWeight: 700, align: 'center' }, { role: 'logo', x: 340, y: 100, w: 400, h: 200, lines: 1, color: '#000000', fontFamily: 'Inter', fontWeight: 400, align: 'center' }];
    const image = await request(app).post(`/api/v1/templates/${id}/text-zones/preview`).set(auth(admin)).send({ zones }).buffer(true).parse(buf);
    expect(image.status).toBe(200);
    expect(await sharp(image.body).metadata()).toMatchObject({ format: 'png', width: 1080, height: 1920 });
    expect((await request(app).post(`/api/v1/templates/${id}/text-zones/preview`).set(auth(org)).send({ zones })).status).toBe(404);

    // edited: renamed, moved under a category, then made general to it again
    const category = await Category.create({ name: 'Cards', subcategories: [{ name: 'Pink' }] });
    const patch = (body: object) => request(app).patch(`/api/v1/templates/${id}`).set(auth(admin)).send(body);
    expect((await patch({ name: 'Pink two', categoryId: String(category._id), subcategoryId: String(category.subcategories[0]._id) })).status).toBe(200);
    expect((await patch({ name: 'Pink', subcategoryId: null })).status).toBe(200);
    const edited: any = await Template.findById(id).lean();
    expect([edited.name, String(edited.categoryId), edited.subcategoryId]).toEqual(['Pink', String(category._id), undefined]);
    const master = await Template.findOne({ cardDesign: 'MASTER', isActive: { $ne: false } });
    expect((await request(app).delete(`/api/v1/templates/${master!._id}`).set(auth(admin))).status).toBe(409);

    // unpublished: gone from organizers, still listed for the administrator to publish again
    expect((await request(app).patch(`/api/v1/templates/${id}`).set(auth(admin)).send({ isPublished: false })).status).toBe(200);
    expect((await request(app).get('/api/v1/templates').set(auth(org))).body.data.map((t: any) => t.name)).not.toContain('Pink');
    expect((await request(app).get('/api/v1/templates').set(auth(second))).body.data.map((t: any) => t.name)).toContain('Pink');
    expect((await request(app).delete(`/api/v1/templates/${id}`).set(auth(second))).status).toBe(200);
    expect((await request(app).get('/api/v1/templates').set(auth(second))).body.data.map((t: any) => t.name)).not.toContain('Pink');
  });
});

describe('uploading invitees with the number of guests', () => {
  it('stores it and returns it with the guest', async () => {
    const event = await makeEvent(org);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(withGuests([['Name', 'Email', 'Mobile', 'No of Guests'], ['Family', 'f@g.test', '', 6]])), 'I');
    const res = await request(app).post(`/api/v1/events/${event._id}/invitees/import`).set(auth(org)).field('mode', 'APPEND').attach('file', xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'g.xlsx');
    expect(res.body.data.imported).toBe(1);
    const list = (await request(app).get(`/api/v1/events/${event._id}/invitees`).set(auth(org))).body.data;
    expect(list[0].guestCount).toBe(6);
    const session = await Session.create({ eventId: event._id, name: 'Main', schedule: event.schedule, accessControl: AccessControl.ONLY_ONCE, validateAgainstOtherSessions: false, inviteeSource: InviteeSource.NEW_LIST });
    await CheckIn.create({ eventId: event._id, inviteeId: list[0]._id, sessionId: session._id, checkInMethod: 'QR', checkedInBy: org._id, scanCount: 4 });
    const report = (await request(app).get(`/api/v1/reports/events/${event._id}`).set(auth(org))).body.data;
    // (the guest has no written session rules until the sheet or a later session writes them)
    expect(report.sessionReports[0]).toMatchObject({ attendeeCount: 1, admittedCount: 4 });
    const records = (await request(app).get(`/api/v1/events/${event._id}/checkins`).set(auth(org))).body.data;
    expect(records[0]).toMatchObject({ admitted: 4, guestCount: 6 });
    await Invitee.updateOne({ _id: list[0]._id }, { sessionAccess: [] });
    expect((await request(app).get(`/api/v1/reports/events/${event._id}`).set(auth(org))).body.data.sessionReports[0].expectedGuests).toBe(6);
    expect((await request(app).patch(`/api/v1/invitees/${list[0]._id}`).set(auth(org)).send({ guestCount: 101 })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/invitees/${list[0]._id}`).set(auth(org)).send({ guestCount: 8 })).body.data.guestCount).toBe(8);
  });
});
