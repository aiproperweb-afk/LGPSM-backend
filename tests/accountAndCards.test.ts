import request from 'supertest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Media, MediaPurpose } from '../src/models/Media';
import { Template } from '../src/models/Template';
import { Event } from '../src/models/Event';
import { Notification } from '../src/models/Notification';
import { generateAccessToken } from '../src/utils/token';

jest.mock('../src/utils/email.provider', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.setTimeout(120_000);

describe('account type, GST number, and an administrator\'s card uploads', () => {
  let mongo: MongoMemoryServer; let org: any; let admin: any;
  const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });
  const saved = async () => (await User.findById(org._id).lean()) as any;
  const profile = (body: object) => request(app).patch('/api/users/profile').set(auth(org)).send(body);
  const picture = async (owner: any) => {
    const data = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#cc1122' } }).png().toBuffer();
    const m = await Media.create({ ownerId: owner._id, purpose: MediaPurpose.TEMPLATE, contentType: 'image/png', size: data.length, width: 800, height: 1200, data });
    return `media:${m._id}`;
  };
  const upload = async (u: any, extra: object = {}) => request(app).post('/api/v1/templates/upload').set(auth(u)).send({ imageKey: await picture(u), ...extra });
  const listed = async (u: any) => (await request(app).get('/api/v1/templates').set(auth(u))).body.data.map((t: any) => t._id);

  beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
  afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Template.deleteMany({}), Event.deleteMany({}), Notification.deleteMany({}), Media.deleteMany({})]);
    org = await User.create({ fullName: 'Org Person', email: 'org@acc.test', role: Role.ORGANIZER, isActive: true, passwordHash: 'x', profile: { organizationType: 'ORGANIZATION', organizationName: 'Acme', logoKey: 'media:aaaaaaaaaaaaaaaaaaaaaaaa' } });
    admin = await User.create({ fullName: 'Admin', email: 'admin@acc.test', role: Role.ADMIN, isActive: true, passwordHash: 'x' });
  });

  const details = { name: 'Acme', phone: '', whatsapp: '', email: '', address: '', website: '' };

  it('keeps an optional GST number: saved in capitals, left alone by a screen without the field, removed by an empty one', async () => {
    expect((await profile({ organization: { ...details, gstNumber: '19abcde1234f1z5' } })).status).toBe(200);
    expect((await saved()).profile.organization.gstNumber).toBe('19ABCDE1234F1Z5');
    expect((await profile({ organization: details })).status).toBe(200);
    expect((await saved()).profile.organization.gstNumber).toBe('19ABCDE1234F1Z5');
    expect((await profile({ organization: { ...details, gstNumber: '' } })).status).toBe(200);
    expect((await saved()).profile.organization.gstNumber).toBeUndefined();
    expect((await profile({ organization: { ...details, gstNumber: 'ABC' } })).status).toBe(400);
  });

  it('lets an organizer switch between individual and organization', async () => {
    const asIndividual = { ...(await saved()).profile, organizationType: 'INDIVIDUAL' };
    expect((await profile({ profile: asIndividual })).status).toBe(200);
    let me = await saved();
    expect(me.profile.organizationType).toBe('INDIVIDUAL');
    expect(me.profile.organizationName).toBeUndefined();
    expect(me.profile.logoKey).toBe('media:aaaaaaaaaaaaaaaaaaaaaaaa');
    expect((await profile({ profile: { ...me.profile, organizationType: 'ORGANIZATION' } })).status).toBe(200);
    me = await saved();
    expect(me.profile.organizationType).toBe('ORGANIZATION');
    expect((await profile({ profile: { ...me.profile, organizationType: 'COMPANY' } })).status).toBe(400);
  });

  it('an administrator\'s upload without publishing is a private card: not shared, nothing drawn on it, Digital only', async () => {
    const res = await upload(admin);
    expect(res.status).toBe(201);
    const t: any = await Template.findById(res.body.data._id).lean();
    expect(t).toMatchObject({ isSystemTemplate: false, isPublished: false });
    expect(t.templateData.dynamicDetails).toBeUndefined();
    expect(t.designSpec.elements).toEqual([]);
    expect(await listed(org)).not.toContain(String(t._id));
    expect(await listed(admin)).toContain(String(t._id));
    expect(await Notification.countDocuments({ type: 'TEMPLATE' })).toBe(0);

    // the administrator creates an event for an organizer with it: the organizer gets a copy, under the same rules as their own upload
    const event = (invitationType: string) => request(app).post('/api/v1/events').set(auth(admin)).send({ organizerId: String(org._id), title: 'Gala', description: 'd', format: 'PHYSICAL', location: { address: 'Hall' }, schedule: { start: '2031-01-01T10:00:00.000Z', end: '2031-01-01T12:00:00.000Z' }, templateId: String(t._id), invitationType });
    const printed = await event('PRINT');
    expect(printed.status).toBe(400);
    const made = await event('DIGITAL');
    expect(made.status).toBe(201);
    const stored: any = await Event.findById(made.body.data.eventId).lean();
    const copy: any = await Template.findById(stored.templateId).lean();
    expect(String(copy.ownerId)).toBe(String(org._id));
    expect(copy).toMatchObject({ isSystemTemplate: false, templateData: { uploaded: true } });

    // publishing it from the Templates page shares it; the event's copy stays as it was
    const published = await request(app).patch(`/api/v1/templates/${t._id}`).set(auth(admin)).send({ isPublished: true });
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ isSystemTemplate: true, isPublished: true, templateData: { uploaded: true, dynamicDetails: true } });
    expect(await listed(org)).toContain(String(t._id));
    expect(await Notification.countDocuments({ type: 'TEMPLATE', userId: org._id })).toBe(1);
    expect(((await Template.findById(stored.templateId).lean()) as any).templateData.dynamicDetails).toBeUndefined();
  });

  it('an administrator who publishes while uploading (the Templates page) shares it at once', async () => {
    const res = await upload(admin, { publish: true });
    expect(res.body.data).toMatchObject({ isSystemTemplate: true, isPublished: true, templateData: { dynamicDetails: true } });
    expect(await listed(org)).toContain(res.body.data._id);
  });

  it('an organizer cannot share a card by asking to publish it', async () => {
    const res = await upload(org, { publish: true });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isSystemTemplate: false });
    expect(res.body.data.templateData.dynamicDetails).toBeUndefined();
    await request(app).patch(`/api/v1/templates/${res.body.data._id}`).set(auth(org)).send({ isPublished: true });
    expect(((await Template.findById(res.body.data._id).lean()) as any).isSystemTemplate).toBe(false);
  });
});
