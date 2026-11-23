// Clearing the invitee lists after the card details change is refused only when guests were really contacted.
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Category } from '../src/models/Category';
import { Event } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { Invitation } from '../src/models/Invitation';
import { generateAccessToken } from '../src/utils/token';

jest.setTimeout(60000);
const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });
let mongo: MongoMemoryServer; let org: any; let ev: any;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Category.deleteMany({}), Event.deleteMany({}), Invitee.deleteMany({}), Invitation.deleteMany({})]);
  org = await User.create({ fullName: 'Org', email: 'o@x.com', role: Role.ORGANIZER, isActive: true });
  const cat = await Category.create({ name: 'General', isActive: true });
  ev = await Event.create({ organizerId: org._id, title: 'T', description: 'd', categoryId: cat._id, format: 'PHYSICAL', status: 'PUBLISHED', contactNumber: '9007000891', location: { address: 'K' }, schedule: { start: new Date(Date.now() + 864e5), end: new Date(Date.now() + 2 * 864e5) } });
});
const clear = () => request(app).post(`/api/v1/events/${ev._id}/invitees/sets/clear`).set(auth(org)).send({});

it('clears lists whose guests only have a pass made for them, and says nothing was contacted', async () => {
  await Invitee.insertMany([{ eventId: ev._id, name: 'A', email: 'a@x.com', qrTokenHash: 'h1' }, { eventId: ev._id, name: 'B', email: 'b@x.com' }]);
  const r = await clear();
  expect(r.status).toBe(200);
  expect(await Invitee.countDocuments({ eventId: ev._id })).toBe(0);
});

it('refuses after an invitation was sent, a send was left unconfirmed, or cards were downloaded, and says which', async () => {
  const [g]: any[] = await Invitee.insertMany([{ eventId: ev._id, name: 'A', email: 'a@x.com' }]);
  await Invitation.create({ eventId: ev._id, inviteeId: g._id, channel: 'EMAIL', status: 'SENT', tokenHash: 'x' });
  let r = await clear();
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/an invitation was sent/);
  await Invitation.deleteMany({});
  await Invitation.create({ eventId: ev._id, inviteeId: g._id, channel: 'EMAIL', status: 'PENDING', tokenHash: 'y' });
  r = await clear();
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/never confirmed/);
  await Invitation.deleteMany({});
  await Invitee.updateOne({ _id: g._id }, { $set: { cardDownloadedAt: new Date() } });
  r = await clear();
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/cards were downloaded/);
});
