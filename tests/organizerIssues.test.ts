import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Event, EventStatus } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { Invoice } from '../src/models/Invoice';
import { Notification } from '../src/models/Notification';
import { CancellationNotice } from '../src/models/CancellationNotice';
import { generateAccessToken } from '../src/utils/token';

// Organizer issues of 25 Nov: deleting a cancelled event, notices for the organizer's own actions, and billing PDFs
jest.setTimeout(90_000);

describe('organizer issues', () => {
  let mongo: MongoMemoryServer; let org: any; let other: any;
  const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });
  const mkEvent = (extra: Record<string, unknown> = {}) => Event.create({ organizerId: org._id, title: 'Gala Night', description: 'd', categoryId: new mongoose.Types.ObjectId(), format: 'PHYSICAL', location: { address: 'Kolkata' }, schedule: { start: new Date(Date.now() + 864e5), end: new Date(Date.now() + 2 * 864e5) }, status: EventStatus.PUBLISHED, ...extra });
  const mkInvoice = (event: any, n: string, user: any = org) => Invoice.create({ invoiceNumber: n, paymentId: new mongoose.Types.ObjectId(), userId: user._id, eventId: event._id, invitees: 5, subtotal: 15, tax: 2.7, total: 17.7 });
  const titles = async () => { await new Promise((r) => setTimeout(r, 150)); return (await Notification.find({ userId: org._id }).sort({ createdAt: 1 }).lean()).map((n: any) => n.title); };
  const remove = (event: any, title = 'Gala Night') => request(app).post(`/api/v1/events/${event._id}/delete`).set(auth(org)).send({ confirmTitle: title });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    org = await User.create({ fullName: 'Org', email: 'o@iss.test', role: Role.ORGANIZER, isActive: true, passwordHash: 'x' });
    other = await User.create({ fullName: 'Other', email: 'p@iss.test', role: Role.ORGANIZER, isActive: true, passwordHash: 'x' });
  });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
  beforeEach(async () => { await Promise.all([Event.deleteMany({}), Invoice.deleteMany({}), Notification.deleteMany({}), CancellationNotice.deleteMany({}), Invitee.deleteMany({})]); });

  it('an upcoming event that is not cancelled still cannot be deleted', async () => {
    const res = await remove(await mkEvent());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_NOT_CLOSED');
  });

  it('a cancelled upcoming event can be deleted; its invoice stays and still names it; the organizer is told', async () => {
    const event = await mkEvent({ status: EventStatus.CANCELLED });
    await mkInvoice(event, 'INV-1');
    expect((await remove(event, 'wrong title')).status).toBe(400);
    expect((await remove(event)).status).toBe(200);
    expect(await Event.countDocuments()).toBe(0);
    const bills = await request(app).get('/api/v1/billing/invoices').set(auth(org));
    expect(bills.body.data).toEqual([expect.objectContaining({ invoiceId: 'INV-1', eventName: 'Gala Night', eventId: String(event._id) })]);
    expect(await titles()).toEqual(['Event deleted']);
  });

  it('a cancelled event whose guests are still being told cannot be deleted yet', async () => {
    const event = await mkEvent({ status: EventStatus.CANCELLED });
    await CancellationNotice.create({ eventId: event._id, inviteeId: new mongoose.Types.ObjectId(), organizerId: org._id, email: { status: 'PENDING' } });
    const res = await remove(event);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOTICES_PENDING');
    await CancellationNotice.updateMany({}, { 'email.status': 'UNAVAILABLE' });
    expect((await remove(event)).status).toBe(200);
  });

  it('cancelling puts a notice on the organizer\'s own list', async () => {
    const event = await mkEvent();
    const res = await request(app).post(`/api/v1/events/${event._id}/cancel`).set(auth(org)).send({ reason: 'Rain' });
    expect(res.status).toBe(200);
    expect(await titles()).toContain('Event cancelled');
  });

  describe('billing PDF', () => {
    const get = (ids: string[], user: any = org) => request(app).get(`/api/v1/billing/statement.pdf?ids=${ids.join(',')}`).set(auth(user)).buffer(true).parse((r, done) => { const parts: Buffer[] = []; r.on('data', (c: Buffer) => parts.push(c)); r.on('end', () => done(null, Buffer.concat(parts))); });

    it('makes one invoice, and one statement for several payments of the same event', async () => {
      const event = await mkEvent();
      const a = await mkInvoice(event, 'INV-A'); const b = await mkInvoice(event, 'INV-B');
      const one = await get([String(a._id)]);
      expect(one.status).toBe(200);
      expect(one.headers['content-type']).toMatch(/application\/pdf/);
      expect(one.headers['content-disposition']).toContain('invoice-INV-A.pdf');
      expect((one.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const two = await get([String(a._id), String(b._id)]);
      expect(two.headers['content-disposition']).toContain('statement-Gala-Night.pdf');
      expect((two.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('never mixes events, and never shows another organizer\'s invoice', async () => {
      const a = await mkInvoice(await mkEvent(), 'INV-C'); const b = await mkInvoice(await mkEvent({ title: 'Second' }), 'INV-D');
      expect((await get([String(a._id), String(b._id)])).status).toBe(400);
      expect((await get([String(a._id)], other)).status).toBe(404);
      expect((await get(['nonsense'])).status).toBe(400);
    });

    it('writes an event title in Bengali, which the PDF\'s own font cannot spell', async () => {
      const event = await mkEvent({ title: 'দুর্গা পূজা উৎসব ২০২৬' });
      const a = await mkInvoice(event, 'INV-E');
      const res = await get([String(a._id)]);
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });
  });
});

describe('guest list filters for cards and food', () => {
  let mongo: MongoMemoryServer; let org: any; let event: any;
  const list = async (query: string) => (await request(app).get(`/api/v1/events/${event._id}/invitees?limit=50&${query}`).set({ Authorization: `Bearer ${generateAccessToken(String(org._id), org.role)}` })).body.data.map((g: any) => g.name).sort();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    org = await User.create({ fullName: 'Org', email: 'f@iss.test', role: Role.ORGANIZER, isActive: true, passwordHash: 'x' });
    event = await Event.create({ organizerId: org._id, title: 'E', description: 'd', categoryId: new mongoose.Types.ObjectId(), format: 'PHYSICAL', location: { address: 'x' }, schedule: { start: new Date(Date.now() + 864e5), end: new Date(Date.now() + 2 * 864e5) }, status: 'PUBLISHED' });
    const g = (name: string, extra: Record<string, unknown>) => ({ eventId: event._id, name, email: `${name}@f.test`, ...extra });
    await Invitee.collection.insertMany([
      g('veg', { dietarySelections: [{ title: 'Food', value: 'Veg' }], cardDownloadedAt: new Date() }),
      g('nonveg', { dietarySelections: [{ title: 'Food', value: 'Non-veg' }] }),
      g('oldveg', { dietaryPreference: 'Veg' }),
      g('oldpair', { dietaryPreference: 'Drink: Tea · Food: Veg' }),
      g('none', {}),
    ].map((x) => ({ ...x, eventId: event._id, archivedAt: null })));
  });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

  it('filters by whether the card was downloaded', async () => {
    expect(await list('cards=DOWNLOADED')).toEqual(['veg']);
    expect(await list('cards=NOT_DOWNLOADED')).toEqual(['none', 'nonveg', 'oldpair', 'oldveg']);
  });
  it('filters by a food answer, including answers saved the older way; an odd value is taken literally', async () => {
    expect(await list('foodTitle=Food&foodValue=Veg')).toEqual(['oldpair', 'oldveg', 'veg']);
    expect(await list('foodTitle=Food&foodValue=Non-veg')).toEqual(['nonveg']);
    expect(await list(`foodTitle=Food&foodValue=${encodeURIComponent('.*')}`)).toEqual([]);
  });
});
