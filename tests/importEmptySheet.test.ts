import mongoose from 'mongoose';
import supertest from 'supertest';
import xlsx from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Event } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { InviteeSet } from '../src/models/InviteeSet';
import { generateAccessToken } from '../src/utils/token';
import { withGuests } from './helpers/withGuests';

// Audit finding F-04: a spreadsheet with only its heading row was accepted (200, nothing imported). It is now refused, and a refused
// upload changes nothing, in either mode.
const request = supertest(app);
jest.setTimeout(60_000);

describe('importing sheets with nothing to import', () => {
  let mongo: MongoMemoryServer; let org: any, event: any, auth: { Authorization: string };
  const sheet = (rows: (string | number)[][]) => { const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(withGuests(rows)), 'I'); return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; };
  const upload = (rows: (string | number)[][] | Buffer, mode: string, extra: Record<string, string> = {}) => {
    let r = request.post(`/api/v1/events/${event._id}/invitees/import`).set(auth).field('mode', mode);
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach('file', Buffer.isBuffer(rows) ? rows : sheet(rows), 'guests.xlsx');
  };
  const snapshot = async () => JSON.stringify({ guests: (await Invitee.find({ eventId: event._id }).sort({ email: 1 }).lean()).map((g: any) => [g.email, g.name, !!g.archivedAt, String(g.inviteeSetId || '')]), sets: await InviteeSet.countDocuments({ eventId: event._id }) });
  const H = ['Name', 'Email', 'Mobile'];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    org = await User.create({ fullName: 'Org', email: 'org@imp.test', role: Role.ORGANIZER, passwordHash: 'x', isActive: true });
    auth = { Authorization: `Bearer ${generateAccessToken(String(org._id), org.role)}` };
    event = await Event.create({ organizerId: org._id, title: 'E', description: 'd', categoryId: new mongoose.Types.ObjectId(), format: 'PHYSICAL', location: { type: 'Point', address: 'x', coordinates: [0, 0] } as any, schedule: { start: new Date(Date.now() + 3600e3), end: new Date(Date.now() + 7200e3) }, status: 'PUBLISHED' });
    expect((await upload([H, ['Keep One', 'keep1@imp.test', ''], ['Keep Two', 'keep2@imp.test', '']], 'APPEND')).status).toBe(200);
  });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

  it.each(['APPEND', 'REPLACE'])('%s: a heading-only sheet is refused with an explanation and nothing changes', async (mode) => {
    const before = await snapshot();
    const res = await upload([H], mode);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/heading row but no invitee rows/i);
    expect(await snapshot()).toBe(before);
  });
  it.each(['APPEND', 'REPLACE'])('%s: a heading-only dry run is refused too', async (mode) => {
    const before = await snapshot();
    expect((await upload([H], mode, { dryRun: 'true' })).status).toBe(400);
    expect(await snapshot()).toBe(before);
  });
  it('a heading plus blank rows is the same as heading only', async () => {
    expect((await upload([H, ['', '', ''], [' ', '', '']], 'REPLACE')).status).toBe(400);
  });
  it('a completely empty workbook is refused', async () => {
    const before = await snapshot();
    expect((await upload([], 'REPLACE')).status).toBe(400);
    expect(await snapshot()).toBe(before);
  });
  it('a file that is not a workbook is refused', async () => {
    const before = await snapshot();
    const res = await upload(Buffer.from('this is not a spreadsheet'), 'REPLACE');
    expect(res.status).toBe(400);
    expect(await snapshot()).toBe(before);
  });
  it('rows that are all invalid are reported, not imported, and do not wipe the current list (REPLACE)', async () => {
    const before = await snapshot();
    const res = await upload([H, ['', 'a@b.test', ''], ['X', 'not-an-email', ''], ['Y', '', '']], 'REPLACE');
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.rejected).toBe(3);
    expect(await snapshot()).toBe(before);
  });
  it('mixed valid and invalid rows still import the valid ones (APPEND)', async () => {
    const res = await upload([H, ['Good Guest', 'good@imp.test', ''], ['', 'bad@imp.test', ''], ['Worse', 'nope', '']], 'APPEND');
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.rejected).toBe(2);
    expect(await Invitee.countDocuments({ eventId: event._id, email: 'good@imp.test' })).toBe(1);
  });
  it('a valid REPLACE still works and sets the untouched earlier guests aside (not deleted)', async () => {
    const res = await upload([H, ['Fresh Guest', 'fresh@imp.test', '']], 'REPLACE');
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.archived).toBeGreaterThan(0);
    expect(await Invitee.collection.countDocuments({ eventId: event._id, email: 'keep1@imp.test' })).toBe(1); // archived rows are hidden from normal queries, not erased
  });
  it('a sheet without the "No of Guests" column is refused with an explanation and nothing changes', async () => {
    const before = await snapshot();
    const raw = (rows: string[][]) => { const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), 'I'); return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; };
    for (const rows of [[H, ['No Count', 'nocount@imp.test', '']], [['Headless Person', 'headless@imp.test', '']]]) {
      const res = await upload(raw(rows), 'REPLACE');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('"No of Guests" column');
      expect(await snapshot()).toBe(before);
    }
  });
  it('the number of guests is read per row, required, and kept up to date by a later sheet', async () => {
    const G = [...H, 'No. of Guests'];
    const first = await upload([G, ['Family One', 'family@imp.test', '', 10], ['Blank Count', 'blank@imp.test', '', ''], ['Half', 'half@imp.test', '', '2.5'], ['Crowd', 'crowd@imp.test', '', 101], ['Nobody', 'nobody@imp.test', '', 0]], 'APPEND');
    expect(first.body.data).toMatchObject({ imported: 1, rejected: 4 });
    expect(first.body.data.errors.map((e: any) => e.error)).toEqual(['No of Guests is required', expect.stringContaining("Invalid No of Guests '2.5'"), expect.stringContaining("'101'"), expect.stringContaining("'0'")]);
    const family = () => Invitee.findOne({ eventId: event._id, email: 'family@imp.test' }).lean<any>();
    expect(await family()).toMatchObject({ name: 'Family One', guestCount: 10 });
    const again = await upload([G, ['Family One', 'family@imp.test', '', 4]], 'APPEND');
    expect(again.body.data.notices.map((n: any) => n.message)).toContain('Family One: No of Guests changed from 10 to 4');
    expect((await family()).guestCount).toBe(4);
  });
});
