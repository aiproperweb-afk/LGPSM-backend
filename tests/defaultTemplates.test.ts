import request from 'supertest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { Category } from '../src/models/Category';
import { Template } from '../src/models/Template';
import { Media } from '../src/models/Media';
import { User, Role } from '../src/models/User';
import { generateAccessToken } from '../src/utils/token';
import { DEFAULT_TEMPLATES, planDefaultTemplates, installDefaultTemplates } from '../src/services/cardTemplates/defaultTemplates';

const BUSINESS = ['Business Conference', 'Product Launch', 'Networking Event', 'Corporate Meet'];
const FESTIVALS = ['Festival Celebration', 'Puja Gathering', 'Cultural Program', 'Community Fair'];
const BIRTHDAYS = ['Birthday Gold Balloons', 'Birthday Lilac Balloons', 'Birthday Pink Watercolour', 'Birthday Rainbow Stars'];
// One card for each of the other Personal & Family event types
const FAMILY = ['Baby Shower Blue Ribbon', 'Annaprasan Lotus', 'Griha Pravesh Marigold', 'Anniversary Sage Florals', 'Engagement Pink Blossoms', 'Haldi Sunflowers', 'Mehendi Green Arch', 'Sangeet Lanterns', 'Wedding Reception Blush'];
const EDUCATION = ['Convocation Gold Frame', 'Freshers Welcome Night', 'Farewell Fairy Lights', 'College Fest Stage'];
const ENTERTAINMENT = ['Live Concert Vinyl', 'Comedy Show Curtain', 'DJ Night Party', 'Food Festival Stalls', 'Exhibition Art Waves'];
const SPORTS = ['Cricket Stadium Blue', 'Football Night Match', 'Marathon Night Run', 'Fitness Event Power'];
const ALL = ['Master Card', ...BUSINESS, ...FESTIVALS, ...BIRTHDAYS, ...FAMILY, ...EDUCATION, ...SPORTS, ...ENTERTAINMENT];

jest.setTimeout(180000);

let mongoServer: MongoMemoryServer;
let admin: any;
let organizer: any;
const bearer = (u: any) => `Bearer ${generateAccessToken(String(u._id), u.role)}`;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  admin = await User.create({ fullName: 'Root', email: 'root.tpl@example.com', role: Role.ADMIN, isActive: true, isEmailVerified: true });
  organizer = await User.create({ fullName: 'Org', email: 'org.tpl@example.com', role: Role.ORGANIZER, isActive: true, isEmailVerified: true });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
beforeEach(async () => {
  await Promise.all([Category.deleteMany({}), Template.deleteMany({}), Media.deleteMany({})]);
});

describe('installing the default templates', () => {
  it('offers the master card for every event, four cards each for business and festivals, four birthday cards, one for every other family event and four each for education and sports and five for entertainment', () => {
    expect(DEFAULT_TEMPLATES.map((t) => [t.name, t.category])).toEqual([
      ['Master Card', undefined],
      ...BUSINESS.map((n) => [n, 'Business & Corporate']),
      ...FESTIVALS.map((n) => [n, 'Festivals & Culture']),
      ...[...BIRTHDAYS, ...FAMILY].map((n) => [n, 'Personal & Family']),
      ...EDUCATION.map((n) => [n, 'Education & Campus']),
      ...SPORTS.map((n) => [n, 'Sports & Fitness']),
      ...ENTERTAINMENT.map((n) => [n, 'Entertainment & Social'])
    ]);
  });

  it('plans them on an empty database, without writing anything', async () => {
    const plan = await planDefaultTemplates();
    expect(plan.templatesToCreate.map((t) => t.name)).toEqual(ALL);
    expect(plan.categoriesToCreate).toEqual(['Business & Corporate', 'Festivals & Culture', 'Personal & Family', 'Education & Campus', 'Sports & Fitness', 'Entertainment & Social']);
    expect(await Template.countDocuments()).toBe(0);
    expect(await Category.countDocuments()).toBe(0);
  });

  it('leaves what exists as it was, and adds only the missing subcategories to a category with the same name', async () => {
    const personal = await Category.create({ name: 'Personal', isActive: true, subcategories: [{ name: 'Birthday' }] });
    const business = await Category.create({ name: 'business & corporate', isActive: true, subcategories: [{ name: 'Product launch' }] });
    const existing = await Template.create({ name: 'Bday Template 1', categoryId: personal._id });
    const before = await Template.findById(existing._id).lean();
    const result = await installDefaultTemplates(String(admin._id));
    expect(result.created).toEqual(ALL);
    expect(await Template.findById(existing._id).lean()).toEqual(before);
    expect(await Category.countDocuments()).toBe(7); // Personal, the existing business one, Festivals & Culture, Personal & Family, Education & Campus, Sports & Fitness and Entertainment & Social
    const after: any = await Category.findById(business._id).lean();
    expect(after.name).toBe('business & corporate');
    expect(after.subcategories.map((c: any) => c.name)).toEqual(['Product launch', 'Business Conference', 'Networking Event', 'Corporate Meet']);
  });

  it('creates each one published, under its event type, with a preview image', async () => {
    await installDefaultTemplates(String(admin._id));
    const templates: any[] = await Template.find({}).lean();
    expect(templates).toHaveLength(ALL.length);
    const categories: any[] = await Category.find({}).lean();
    for (const spec of DEFAULT_TEMPLATES) {
      const t = templates.find((x) => x.name === spec.name);
      expect(t).toMatchObject({ cardDesign: spec.cardDesign, isPublished: true, isActive: true, isSystemTemplate: true });
      if (!spec.category) expect(t.categoryId).toBeUndefined();
      else {
        const category = categories.find((c) => String(c._id) === String(t.categoryId));
        expect(category.name).toBe(spec.category);
        expect(category.subcategories.find((c: any) => String(c._id) === String(t.subcategoryId)).name).toBe(spec.subcategory);
      }
      const media = await Media.findById(t.previewImageKey.slice(6)).select('+data');
      expect(media!.contentType).toBe('image/jpeg');
      const meta = await sharp(media!.data).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBeGreaterThan(300);
    }
  });

  it('is safe to run again: nothing is created twice', async () => {
    await installDefaultTemplates(String(admin._id));
    const second = await installDefaultTemplates(String(admin._id));
    expect(second.created).toEqual([]);
    expect(await Template.countDocuments()).toBe(ALL.length);
    expect(await Media.countDocuments()).toBe(ALL.length);
    expect((await planDefaultTemplates()).templatesToCreate).toEqual([]);
  });
});

describe('default templates API', () => {
  it('is for admins only', async () => {
    expect((await request(app).get('/api/v1/templates/defaults')).status).toBe(401);
    expect((await request(app).get('/api/v1/templates/defaults').set('Authorization', bearer(organizer))).status).toBe(403);
    expect((await request(app).post('/api/v1/templates/defaults').set('Authorization', bearer(organizer))).status).toBe(403);
    expect(await Template.countDocuments()).toBe(0);
  });

  it('shows the plan, then installs, and organizers can then pick the templates', async () => {
    const plan = await request(app).get('/api/v1/templates/defaults').set('Authorization', bearer(admin));
    expect(plan.status).toBe(200);
    expect(plan.body.data.templatesToCreate).toHaveLength(DEFAULT_TEMPLATES.length);
    expect(await Template.countDocuments()).toBe(0); // a preview changes nothing

    const installed = await request(app).post('/api/v1/templates/defaults').set('Authorization', bearer(admin));
    expect(installed.status).toBe(200);
    expect(installed.body.data.created).toHaveLength(DEFAULT_TEMPLATES.length);

    const list = await request(app).get('/api/v1/templates').set('Authorization', bearer(organizer));
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: any) => t.name).sort()).toEqual([...ALL].sort());
  });

  it('serves each preview image to anyone who can see the template', async () => {
    await installDefaultTemplates(String(admin._id));
    const t = await Template.findOne({ name: 'Master Card' }).lean();
    const res = await request(app).get(`/api/v1/media/${t!.previewImageKey!.slice(6)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('still rejects a malformed template id', async () => {
    expect((await request(app).get('/api/v1/templates/not-an-id').set('Authorization', bearer(admin))).status).toBe(400);
  });
});
