import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { platformSettingsService } from '../src/services/platformSettings.service';
import { generateAccessToken } from '../src/utils/token';

// GET /api/v1/billing/rate: an organizer reads their own price per invitee and the GST, and nothing else
jest.setTimeout(90_000);

describe('an organizer\'s own price', () => {
  let mongo: MongoMemoryServer; let admin: any; let org: any; let other: any; let staff: any;
  const get = (u?: any) => {
    const r = request(app).get('/api/v1/billing/rate');
    return u ? r.set({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` }) : r;
  };
  const make = (fullName: string, role: Role, extra: object = {}) => User.create({ fullName, email: `${fullName.toLowerCase()}@rate.test`, role, isActive: true, passwordHash: 'x', ...extra });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    admin = await make('Admin', Role.ADMIN);
    org = await make('Org', Role.ORGANIZER);
    other = await make('Other', Role.ORGANIZER, { customRatePerInvitee: 2.5 });
    staff = await make('Staff', Role.SYSTEM_USER);
  });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

  it('is the platform rate and GST, and follows the administrator\'s changes', async () => {
    await platformSettingsService.updateRate(String(admin._id), 4);
    await platformSettingsService.updateGst(String(admin._id), 12);
    const res = await get(org);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ratePerInvitee: 4, gstPercent: 12, custom: false, currency: 'INR' });
  });

  it('is the organizer\'s own rate when the administrator set one, and only ever their own', async () => {
    expect((await get(other)).body.data).toMatchObject({ ratePerInvitee: 2.5, custom: true });
    expect((await get(org).query({ organizerId: String(other._id) })).body.data).toMatchObject({ ratePerInvitee: 4, custom: false });
  });

  it('is for signed-in organizers only', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(admin)).status).toBe(403);
    expect((await get(staff)).status).toBe(403);
  });
});
