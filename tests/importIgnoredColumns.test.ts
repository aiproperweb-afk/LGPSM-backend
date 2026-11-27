import mongoose from 'mongoose';
import supertest from 'supertest';
import xlsx from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Event } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { generateAccessToken } from '../src/utils/token';

// An old guest list with more columns than the event needs: only what the event's card settings ask for is stored
const request = supertest(app);
jest.setTimeout(60_000);

describe('importing a sheet with columns the event does not use', () => {
  let mongo: MongoMemoryServer; let org: any, auth: { Authorization: string };
  const H = ['Name', 'Email', 'Mobile', 'Employee ID', 'Company Name'];
  const sheet = (rows: string[][]) => { const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), 'I'); return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; };
  const importInto = async (extra: Record<string, unknown>, email: string) => {
    const event = await Event.create({ organizerId: org._id, title: 'E', description: 'd', categoryId: new mongoose.Types.ObjectId(), format: 'PHYSICAL', location: { type: 'Point', address: 'x', coordinates: [0, 0] } as any, schedule: { start: new Date(Date.now() + 3600e3), end: new Date(Date.now() + 7200e3) }, status: 'PUBLISHED', ...extra });
    const res = await request.post(`/api/v1/events/${event._id}/invitees/import`).set(auth).field('mode', 'APPEND').attach('file', sheet([H, ['Pia Roy', email, '9876543210', 'E-4521', 'Acme']]), 'old.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    return (await Invitee.findOne({ eventId: event._id }))!;
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    org = await User.create({ fullName: 'Org', email: 'org@cols.test', role: Role.ORGANIZER, passwordHash: 'x', isActive: true });
    auth = { Authorization: `Bearer ${generateAccessToken(String(org._id), org.role)}` };
  });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

  it('takes only name, email and mobile when the event asks for nothing else', async () => {
    const g = await importInto({ cardDisplay: { inviteeName: true } }, 'a@cols.test');
    expect([g.name, g.email, g.mobile]).toEqual(['Pia Roy', 'a@cols.test', '9876543210']);
    expect(g.companyName).toBeUndefined();
    expect(g.professionalIdentity).toBeUndefined();
    expect((g as any).secondaryIdentity).toBeUndefined();
  });
  it('takes the company when the card prints it, and nothing more', async () => {
    const g = await importInto({ cardDisplay: { inviteeName: true }, cardInfo: { primary: 'INVITEE_NAME', secondary: 'COMPANY_NAME' } }, 'b@cols.test');
    expect(g.companyName).toBe('Acme');
    expect(g.professionalIdentity).toBeUndefined();
  });
  it('fills a custom card detail from the organizer\'s own heading', async () => {
    const g = await importInto({ cardDisplay: { inviteeName: true }, cardInfo: { primary: 'INVITEE_NAME', secondary: 'PROFESSIONAL_IDENTITY', identityLabel: 'Employee ID' } }, 'c@cols.test');
    expect(g.professionalIdentity).toBe('E-4521');
    expect(g.companyName).toBeUndefined();
  });
  it('keeps every detail on an old event that has no card settings', async () => {
    const g = await importInto({}, 'd@cols.test');
    expect(g.companyName).toBe('Acme');
    expect(g.professionalIdentity).toBe('E-4521');
  });
});
