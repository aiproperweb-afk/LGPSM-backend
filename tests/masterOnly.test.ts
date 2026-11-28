/**
 * Master-card-only mode: the shared designs are the master card and the themed cards. The designs from before the master card are not
 * listed or drawn, and an event made with one gets the master card.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Template } from '../src/models/Template';
import { Category } from '../src/models/Category';
import { Media, MediaPurpose } from '../src/models/Media';
import { Event } from '../src/models/Event';
import { generateAccessToken } from '../src/utils/token';
import { loadCardContext } from '../src/services/cardTemplates/context';
import { renderTemplatePreview } from '../src/services/cardTemplates/preview';

jest.mock('../src/utils/email.provider', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.setTimeout(180_000);

const auth = (u: any) => ({ Authorization: `Bearer ${generateAccessToken(String(u._id), u.role)}` });

describe('the master card is the only template', () => {
  let mongo: MongoMemoryServer;
  let admin: any, org: any, oldTemplate: any;

  beforeAll(async () => {
    process.env.MASTER_CARD_ONLY = 'true';
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    admin = await User.create({ fullName: 'Admin', email: 'only.admin@x.com', role: Role.ADMIN, isActive: true, isEmailVerified: true });
    org = await User.create({ fullName: 'Org', email: 'only.org@x.com', role: Role.ORGANIZER, isActive: true, isEmailVerified: true });
    oldTemplate = await Template.create({ name: 'Birthday Party', cardDesign: 'BIRTHDAY', isSystemTemplate: true, isPublished: true, isActive: true });
  });
  afterAll(async () => { delete process.env.MASTER_CARD_ONLY; await mongoose.disconnect(); await mongo.stop(); });

  const SHARED = ['Master Card', 'Business Conference', 'Product Launch', 'Networking Event', 'Corporate Meet', 'Festival Celebration', 'Puja Gathering', 'Cultural Program', 'Community Fair', 'Birthday Gold Balloons', 'Birthday Lilac Balloons', 'Birthday Pink Watercolour', 'Birthday Rainbow Stars', 'Baby Shower Blue Ribbon', 'Annaprasan Lotus', 'Griha Pravesh Marigold', 'Anniversary Sage Florals', 'Engagement Pink Blossoms', 'Haldi Sunflowers', 'Mehendi Green Arch', 'Sangeet Lanterns', 'Wedding Reception Blush'];
  const names = async (who: any, query = '') => (await request(app).get(`/api/v1/templates${query}`).set(auth(who))).body.data.map((t: any) => t.name).sort();

  it('lists only the current shared cards (installed the first time they are needed) to an organizer and to an admin', async () => {
    for (const who of [org, admin]) {
      const res = await request(app).get('/api/v1/templates').set(auth(who));
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: any) => t.name).sort()).toEqual([...SHARED].sort());
    }
    expect(await Template.countDocuments({ cardDesign: 'MASTER' })).toBe(1);
  });

  it('keeps a themed card the organizer chose, and draws it for the event and in the form preview', async () => {
    const chosen: any = await Template.findOne({ cardDesign: 'PUJA_GATHERING' }).lean();
    const made = await request(app).post('/api/v1/events').set(auth(org)).send({
      title: 'Ganesh Puja', description: 'd', format: 'PHYSICAL', categoryId: String(chosen.categoryId), subcategoryId: String(chosen.subcategoryId), templateId: String(chosen._id),
      location: { address: 'Hall' }, schedule: { start: '2031-03-01T10:00:00.000Z', end: '2031-03-01T12:00:00.000Z' }
    });
    expect(made.status).toBe(201);
    const event: any = await Event.findById(made.body.data.eventId).lean();
    expect(String(event.templateId)).toBe(String(chosen._id));
    expect((await loadCardContext(event)).cardDesign).toBe('PUJA_GATHERING');
    const input = { title: 'Ganesh Puja', venue: 'Hall' };
    const themed = await renderTemplatePreview(String(chosen._id), input, false, String(org._id));
    expect(await sharp(themed).metadata()).toMatchObject({ width: 786, height: 1364 });
    expect(themed.equals(await renderTemplatePreview(null, input, false, String(org._id)))).toBe(false);
  });

  it('hides an unpublished card from organizers, and does not bring back one an administrator deleted', async () => {
    await Template.updateOne({ cardDesign: 'PRODUCT_LAUNCH' }, { isPublished: false });
    const launch: any = await Template.findOne({ cardDesign: 'PRODUCT_LAUNCH' }).lean();
    expect(await names(org)).not.toContain('Product Launch');
    expect(await names(admin)).toContain('Product Launch');
    await expect(renderTemplatePreview(String(launch._id), { title: 'x' }, false, String(org._id))).rejects.toThrow('TEMPLATE_NOT_FOUND');
    const fair: any = await Template.findOne({ cardDesign: 'COMMUNITY_FAIR' }).lean();
    expect((await request(app).delete(`/api/v1/templates/${fair._id}`).set(auth(admin))).status).toBe(200);
    expect(await names(admin)).not.toContain('Community Fair');
    expect(await Template.countDocuments({ cardDesign: 'COMMUNITY_FAIR' })).toBe(1);
  });

  it('makes an event that asks for an older template with the master card', async () => {
    const category = await Category.create({ name: 'Personal', isActive: true });
    const res = await request(app).post('/api/v1/events').set(auth(org)).send({
      title: 'Birthday Bash', description: 'd', format: 'PHYSICAL', categoryId: String(category._id), templateId: String(oldTemplate._id),
      location: { address: 'Hall' }, schedule: { start: '2031-01-01T10:00:00.000Z', end: '2031-01-01T12:00:00.000Z' }
    });
    expect(res.status).toBe(201);
    const event: any = await Event.findById(res.body.data.eventId).lean();
    const master: any = await Template.findOne({ cardDesign: 'MASTER' }).lean();
    expect(String(event.templateId)).toBe(String(master._id));
    expect((await loadCardContext(event)).cardDesign).toBe('MASTER');
  });

  it('draws the master card for an event that still points at an older template, and in the form preview', async () => {
    const category = await Category.create({ name: 'Anything', isActive: true });
    const old: any = await Event.create({ organizerId: org._id, title: 'Old', description: 'd', format: 'PHYSICAL', categoryId: category._id, templateId: oldTemplate._id, schedule: { start: new Date(), end: new Date(Date.now() + 36e5) } });
    expect((await loadCardContext(old)).cardDesign).toBe('MASTER');
    const png = await renderTemplatePreview(String(oldTemplate._id), { title: 'Preview' }, false, String(org._id));
    expect(await sharp(png).metadata()).toMatchObject({ width: 786, height: 1364 });
  });

  it('still lists, draws and keeps an organizer\'s own uploaded template (the master card is the only SHARED template)', async () => {
    const other = await User.create({ fullName: 'Other', email: 'only.other@x.com', role: Role.ORGANIZER, isActive: true, isEmailVerified: true });
    const data = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#cc1122' } }).png().toBuffer();
    const m = await Media.create({ ownerId: org._id, purpose: MediaPurpose.TEMPLATE, contentType: 'image/png', size: data.length, width: 800, height: 1200, data });
    const up = await request(app).post('/api/v1/templates/upload').set(auth(org)).send({ name: 'My Static Card', imageKey: `media:${m._id}` });
    expect(up.status).toBe(201);
    const uploadId = String(up.body.data._id);

    // the owner sees it next to the master card, in "all" and in "mine"; nobody else does
    expect(await names(org)).toEqual(expect.arrayContaining(['Master Card', 'My Static Card']));
    expect((await request(app).get('/api/v1/templates?scope=mine').set(auth(org))).body.data.map((t: any) => t.name)).toContain('My Static Card');
    expect(await names(other)).not.toContain('My Static Card');

    // an event made with it keeps it, and its card is the uploaded picture
    const category = await Category.create({ name: 'Uploads', isActive: true });
    const body = (templateId: string) => ({ title: 'Static Night', description: 'd', format: 'PHYSICAL', categoryId: String(category._id), templateId, location: { address: 'Hall' }, schedule: { start: '2031-02-01T10:00:00.000Z', end: '2031-02-01T12:00:00.000Z' } });
    const made = await request(app).post('/api/v1/events').set(auth(org)).send(body(uploadId));
    expect(made.status).toBe(201);
    const event: any = await Event.findById(made.body.data.eventId).lean();
    expect(String(event.templateId)).toBe(uploadId);
    const ctx = await loadCardContext(event);
    expect(ctx.cardDesign).toBe('CUSTOM');
    expect(ctx.designSpec).toBeTruthy();
    expect(await sharp(await renderTemplatePreview(uploadId, { title: 'Preview' }, false, String(org._id))).metadata()).toMatchObject({ width: expect.any(Number) });

    // another organizer cannot use it: their event gets the master card
    const theirs = await request(app).post('/api/v1/events').set(auth(other)).send(body(uploadId));
    expect(theirs.status).toBe(201);
    const master: any = await Template.findOne({ cardDesign: 'MASTER' }).lean();
    expect(String((await Event.findById(theirs.body.data.eventId).lean() as any).templateId)).toBe(String(master._id));
  });
});
