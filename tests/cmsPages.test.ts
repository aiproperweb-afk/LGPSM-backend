import homepageSeed from "../src/validators/cms-pages.v1.json";
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { Page, PageStatus } from '../src/models/Page';
import { Media, MediaPurpose } from '../src/models/Media';
import { Role, User } from '../src/models/User';
import { generateAccessToken } from '../src/utils/token';
import { cmsPageService } from '../src/services/cmsPage.service';
import { AuditLog } from '../src/models/AuditLog';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { env } from '../src/config/env';

jest.setTimeout(120_000);

describe('CMS pages', () => {
  let mongo: MongoMemoryServer;
  let admin: any;
  let organizer: any;
  let adminHeaders: Record<string, string>;
  let organizerHeaders: Record<string, string>;

  const puckData = (title = 'First title', imageKey?: string) => {
    const data = structuredClone(homepageSeed[0].data);
    Object.assign(data.content[0].props, { heading: title, ...(imageKey ? { image: imageKey } : {}) });
    return data;
  };

  const createPage = (overrides: Record<string, unknown> = {}) => Page.create({
    name: 'Home',
    slug: 'home',
    route: '/',
    draftData: puckData(),
    publishedData: puckData(),
    status: PageStatus.PUBLISHED,
    schemaVersion: 1,
    version: 1,
    editVersion: 0,
    publishedAt: new Date(),
    ...overrides
  });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([Page.syncIndexes(), Media.syncIndexes()]);
    admin = await User.create({ fullName: 'CMS Admin', email: 'cms-admin@test.local', role: Role.ADMIN, isActive: true });
    organizer = await User.create({ fullName: 'CMS Organizer', email: 'cms-organizer@test.local', role: Role.ORGANIZER, isActive: true });
    adminHeaders = { Authorization: `Bearer ${generateAccessToken(String(admin._id), Role.ADMIN)}` };
    organizerHeaders = { Authorization: `Bearer ${generateAccessToken(String(organizer._id), Role.ORGANIZER)}` };
  });

  beforeEach(async () => {
    await Promise.all([Page.deleteMany({}), Media.deleteMany({})]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('lists page metadata for admins and rejects unauthenticated or non-admin users', async () => {
    await createPage();
    const list = await request(app).get('/api/v1/admin/pages').set(adminHeaders);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ slug: 'home', route: '/', status: 'PUBLISHED', version: 1 });
    expect(list.body.data[0]).not.toHaveProperty('draftData');
    expect((await request(app).get('/api/v1/admin/pages')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/pages').set(organizerHeaders)).status).toBe(403);
  });

  it('returns drafts to admins only and validates page IDs', async () => {
    const page = await createPage({ draftData: puckData('Unsaved'), publishedData: puckData('Live') });
    const result = await request(app).get(`/api/v1/admin/pages/${page.id}`).set(adminHeaders);
    expect(result.status).toBe(200);
    expect(result.body.data.draftData.content[0].props.heading).toBe('Unsaved');
    expect(result.body.data.publishedData.content[0].props.heading).toBe('Live');
    expect((await request(app).get('/api/v1/admin/pages/not-an-id').set(adminHeaders)).status).toBe(400);
    expect((await request(app).get(`/api/v1/admin/pages/${page.id}`).set(organizerHeaders)).status).toBe(403);
  });

  it('saves a draft without changing the public snapshot and can discard it', async () => {
    const page = await createPage();
    const draft = await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
      .set({ ...adminHeaders, 'If-Match': '0' })
      .send({ data: puckData('Draft title') });
    expect(draft.status).toBe(200);
    expect(draft.body.data.editVersion).toBe(1);
    expect(draft.body.data.status).toBe('DRAFT');
    expect(draft.body.data.draftData.content[0].props.heading).toBe('Draft title');

    const published = await request(app).get('/api/v1/public/pages/home');
    expect(published.status).toBe(200);
    expect(published.body.data.content.content[0].props.heading).toBe('First title');
    expect(published.body.data).not.toHaveProperty('draftData');

    const discarded = await request(app).post(`/api/v1/admin/pages/${page.id}/discard-draft`)
      .set({ ...adminHeaders, 'If-Match': '1' });
    expect(discarded.status).toBe(200);
    expect(discarded.body.data.draftData.content[0].props.heading).toBe('First title');
    expect(discarded.body.data.editVersion).toBe(2);
  });

  it('publishes atomically, increments versions and serves only the new published snapshot', async () => {
    const page = await createPage({ status: PageStatus.DRAFT, publishedData: undefined, publishedAt: undefined, version: 0 });
    expect((await request(app).get('/api/v1/public/pages/home')).status).toBe(404);
    const response = await request(app).post(`/api/v1/admin/pages/${page.id}/publish`)
      .set({ ...adminHeaders, 'If-Match': '"0"' })
      .send({ data: puckData('Published title') });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'PUBLISHED', version: 1, editVersion: 1 });
    expect(response.body.data.publishedBy).toBe(String(admin._id));
    const auditFilter = { action: 'CMS_PAGE_PUBLISH', entityId: page._id, status: 'SUCCESS' };
    let audit = await AuditLog.findOne(auditFilter);
    for (let attempt = 0; !audit && attempt < 20; attempt += 1) {
      await delay(25);
      audit = await AuditLog.findOne(auditFilter);
    }
    expect(audit?.actorId.toString()).toBe(String(admin._id));
    const publicPage = await request(app).get('/api/v1/public/pages/home');
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.data.content.content[0].props.heading).toBe('Published title');
    expect((await request(app).get('/api/v1/public/pages/missing')).status).toBe(404);
  });

  it('rejects invalid Puck data and unsafe URLs without changing the draft', async () => {
    const page = await createPage();
    const deeplyNested: { type: string; props: { id: string } }[] = [];
    for (let index = 0; index < 9; index += 1) deeplyNested.push({ type: 'Section', props: { id: `section-${index}` } });
    const zones: Record<string, unknown[]> = {};
    for (let index = 0; index < deeplyNested.length - 1; index += 1) {
      zones[`${deeplyNested[index].props.id}:content`] = [deeplyNested[index + 1]];
    }
    const invalid = [
      puckData('<script>alert(1)</script>'),
      { ...puckData(), content: [...puckData().content].reverse() },
      { root: { props: {} }, content: [{ type: 'Unknown', props: { id: 'x' } }] },
      { root: { props: {} }, content: [{ type: '__proto__', props: { id: 'x' } }] },
      { root: { props: {} }, content: [{ type: 'Text', props: { id: 'x', text: 'hello', constructor: 'unknown' } }] },
      { root: { props: {} }, content: [{ type: 'Button', props: { id: 'x', label: 'Click', href: 'javascript:alert(1)' } }] },
      { root: { props: {} }, content: [{ type: 'Button', props: { id: 'x', label: 'Click', href: '/\\example.org' } }] },
      { root: { props: {} }, content: [{ type: 'Heading', props: { id: 'x', text: 'hello', level: [1] } }] },
      { root: { props: {} }, content: [{ type: 'Text', props: { id: 'x', text: 'hello' } }], zones: { 'x:content': [] } },
      { root: { props: {} }, content: [{ type: 'Text', props: { id: 'x', text: '<script>alert(1)</script>' } }] },
      { root: { props: {} }, content: [{ type: 'Text', props: { id: 'same', text: 'one' } }, { type: 'Text', props: { id: 'same', text: 'two' } }] },
      { root: { props: {} }, content: [deeplyNested[0]], zones }
    ];
    for (const data of invalid) {
      const response = await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
        .set({ ...adminHeaders, 'If-Match': '0' })
        .send({ data });
      expect(response.status).toBe(400);
    }
    expect((await Page.findById(page.id))?.draftData.content[0].props.heading).toBe('First title');
  });

  it('refuses to publish an empty page', async () => {
    const page = await createPage({ status: PageStatus.DRAFT, publishedData: undefined, publishedAt: undefined });
    const response = await request(app).post(`/api/v1/admin/pages/${page.id}/publish`)
      .set({ ...adminHeaders, 'If-Match': '0' })
      .send({ data: { root: { props: {} }, content: [] } });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CMS_CONTENT_INVALID');
  });

  it('requires CMS-approved media references and accepts uploaded CMS media', async () => {
    const page = await createPage();
    expect((await request(app).post('/api/v1/media/upload').field('purpose', 'CMS_PAGE')).status).toBe(401);
    const organizerUpload = await request(app).post('/api/v1/media/upload')
      .set(organizerHeaders)
      .field('purpose', 'CMS_PAGE');
    expect(organizerUpload.status).toBe(403);

    const missingMedia = await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
      .set({ ...adminHeaders, 'If-Match': '0' })
      .send({ data: puckData('With image', 'media:65f000000000000000000001') });
    expect(missingMedia.status).toBe(400);
    expect(missingMedia.body.code).toBe('CMS_MEDIA_INVALID');

    const previousMediaDir = process.env.MEDIA_DIR;
    const dir = await mkdtemp(join(tmpdir(), 'lgpsm-cms-'));
    process.env.MEDIA_DIR = dir;
    try {
      const upload = (file: Buffer) => request(app).post('/api/v1/media/upload')
        .set(adminHeaders).field('purpose', MediaPurpose.CMS_PAGE)
        .attach('file', file, { filename: 'cms.png', contentType: 'image/png' });
      expect((await upload(Buffer.from('invalid image'))).status).toBe(400);
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
      const svg = await request(app).post('/api/v1/media/upload').set(adminHeaders)
        .field('purpose', 'CMS_PAGE').attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          { filename: 'image.svg', contentType: 'image/svg+xml' });
      expect(svg.status).toBe(400);
      expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413);
      const uploaded = await upload(image);
      expect(uploaded.status).toBe(201);
      const key = uploaded.body.data.key;
      const media = await Media.findById(key.slice(6)).select('+data');
      expect(media?.storage).toBe('DISK');
      expect(media?.data).toBeUndefined();
      expect((await request(app).get('/api/v1/media/' + media!.id)).status).toBe(200);
      expect((await readFile(join(dir, media!.fileName!))).length).toBe(uploaded.body.data.size);
      const previousOrigin = process.env.MEDIA_PUBLIC_URL;
      process.env.MEDIA_PUBLIC_URL = 'https://media.eventqrapp.com';
      try {
        const replacement = await upload(image);
        expect(replacement.body.data.publicUrl).toBe('https://media.eventqrapp.com/' + replacement.body.data.key.slice(6) + '.jpg');
        expect((await request(app).get('/api/v1/media/' + media!.id)).headers.location)
          .toBe('https://media.eventqrapp.com/' + media!.fileName);
        expect((await request(app).get('/api/v1/media/' + media!.id + '?raw=1')).status).toBe(200);
      } finally {
        if (previousOrigin === undefined) delete process.env.MEDIA_PUBLIC_URL;
        else process.env.MEDIA_PUBLIC_URL = previousOrigin;
      }

      const accepted = await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
        .set({ ...adminHeaders, 'If-Match': '0' }).send({ data: puckData('With image', key) });
      expect(accepted.status).toBe(200);
      await unlink(join(dir, media!.fileName!));
      const missingFile = await request(app).post(`/api/v1/admin/pages/${page.id}/publish`)
        .set({ ...adminHeaders, 'If-Match': '1' }).send({ data: puckData('With image', key) });
      expect(missingFile.status).toBe(400);
      expect(missingFile.body.code).toBe('CMS_MEDIA_INVALID');
    } finally {
      if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
      else process.env.MEDIA_DIR = previousMediaDir;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a conflict instead of overwriting concurrent edits', async () => {
    const page = await createPage();
    const results = await Promise.all([
      request(app).patch(`/api/v1/admin/pages/${page.id}/draft`).set({ ...adminHeaders, 'If-Match': '0' }).send({ data: puckData('First writer') }),
      request(app).patch(`/api/v1/admin/pages/${page.id}/draft`).set({ ...adminHeaders, 'If-Match': '0' }).send({ data: puckData('Second writer') })
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409 && result.body.code === 'CMS_EDIT_CONFLICT')).toHaveLength(1);
    expect(results.find((result) => result.status === 409)?.body.currentVersion).toBe(1);
  });

  it('requires disk storage for CMS uploads even when a bucket is configured', async () => {
    const previousDir = process.env.MEDIA_DIR;
    const previousBucket = env.AWS_S3_BUCKET;
    delete process.env.MEDIA_DIR;
    env.AWS_S3_BUCKET = 'unused-test-bucket';
    try {
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
      const response = await request(app).post('/api/v1/media/upload').set(adminHeaders)
        .field('purpose', MediaPurpose.CMS_PAGE).attach('file', image, 'cms.png');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('CMS_MEDIA_STORAGE_UNAVAILABLE');
      expect(await Media.countDocuments({ purpose: MediaPurpose.CMS_PAGE })).toBe(0);
    } finally {
      if (previousDir !== undefined) process.env.MEDIA_DIR = previousDir;
      env.AWS_S3_BUCKET = previousBucket;
    }
  });

  it('rejects a temporary CMS directory in production', async () => {
    const previousMode = env.NODE_ENV;
    const previousDir = process.env.MEDIA_DIR;
    const previousOrigin = process.env.MEDIA_PUBLIC_URL;
    env.NODE_ENV = 'production';
    process.env.MEDIA_DIR = tmpdir();
    process.env.MEDIA_PUBLIC_URL = 'https://media.eventqrapp.com';
    try {
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
      const response = await request(app).post('/api/v1/media/upload').set(adminHeaders)
        .field('purpose', MediaPurpose.CMS_PAGE).attach('file', image, 'cms.png');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('CMS_MEDIA_STORAGE_UNAVAILABLE');
    } finally {
      env.NODE_ENV = previousMode;
      if (previousDir === undefined) delete process.env.MEDIA_DIR;
      else process.env.MEDIA_DIR = previousDir;
      if (previousOrigin === undefined) delete process.env.MEDIA_PUBLIC_URL;
      else process.env.MEDIA_PUBLIC_URL = previousOrigin;
    }
  });

  it('requires an edit version and supports locked page structures', async () => {
    const page = await createPage({ componentStructureLocked: true });
    expect((await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`).set(adminHeaders).send({ data: puckData() })).status).toBe(428);
    expect((await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
      .set({ ...adminHeaders, 'If-Match': '"0' }).send({ data: puckData() })).body.code).toBe('IF_MATCH_INVALID');
    const changedStructure = { root: { props: {} }, content: [{ type: 'Text', props: { id: 'different', text: 'Cannot replace' } }] };
    const locked = await request(app).patch(`/api/v1/admin/pages/${page.id}/draft`)
      .set({ ...adminHeaders, 'If-Match': '0' }).send({ data: changedStructure });
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe('CMS_CONTENT_INVALID');
  });

  it('seeds and publishes Contact independently of the homepage', async () => {
    await cmsPageService.seedPages(homepageSeed);
    const page = await Page.findOne({ slug: 'contact' });
    const data = structuredClone(homepageSeed[1].data);
    Object.assign(data.content[0].props, { formHeading: 'Updated Contact' });
    const draft = await request(app).patch('/api/v1/admin/pages/' + page!.id + '/draft')
      .set({ ...adminHeaders, 'If-Match': '"0"' }).send({ data });
    expect(draft.status).toBe(200);
    expect((await request(app).get('/api/v1/public/pages/contact')).body.data.content)
      .toEqual(homepageSeed[1].data);
    const publish = await request(app).post('/api/v1/admin/pages/' + page!.id + '/publish')
      .set({ ...adminHeaders, 'If-Match': '"1"' }).send({ data });
    expect(publish.status).toBe(200);
    expect((await request(app).get('/api/v1/public/pages/contact')).body.data.content).toEqual(data);
    expect((await request(app).get('/api/v1/public/pages/home')).body.data.content)
      .toEqual(homepageSeed[0].data);
  });

  it('hides previously seeded unsupported pages and keeps existing homepage content editable', async () => {
    const retired = await createPage({ name: 'Features', slug: 'features', route: '/features' });
    const existing = puckData('Existing headline');
    const expanded = { ...existing, content: [...existing.content, { type: 'Testimonials', props: { id: 'Testimonials' } }] };
    const home = await createPage({ draftData: expanded, publishedData: expanded });
    const list = await request(app).get('/api/v1/admin/pages').set(adminHeaders);
    expect(list.body.data.map((page: { slug: string }) => page.slug)).toEqual(['home']);
    expect((await request(app).get('/api/v1/public/pages/features')).status).toBe(404);
    expect((await request(app).get('/api/v1/admin/pages/' + retired.id).set(adminHeaders)).status).toBe(404);
    const publicHome = await request(app).get('/api/v1/public/pages/home');
    expect(publicHome.body.data.content).toEqual(existing);
    const edit = await request(app).patch('/api/v1/admin/pages/' + home.id + '/draft')
      .set({ ...adminHeaders, 'If-Match': '0' }).send({ data: puckData('New headline') });
    expect(edit.status).toBe(200);
    expect(edit.body.data.publishedData).toEqual(existing);
  });

  it('seeds published pages idempotently without overwriting admin changes', async () => {
    const seed = [homepageSeed[0]];
    expect(await cmsPageService.seedPages(seed)).toEqual([{ slug: 'home', inserted: true }]);
    const page = await Page.findOne({ slug: 'home' });
    expect(page?.draftData).toEqual(homepageSeed[0].data);
    expect(page?.publishedData).toEqual(homepageSeed[0].data);
    page!.draftData = puckData('Admin edited');
    page!.publishedData = puckData('Admin published');
    page!.version = 4;
    await page!.save();

    expect(await cmsPageService.seedPages(seed)).toEqual([{ slug: 'home', inserted: false }]);
    const unchanged = await Page.findOne({ slug: 'home' });
    expect(unchanged?.draftData.content[0].props.heading).toBe('Admin edited');
    expect(unchanged?.publishedData?.content[0].props.heading).toBe('Admin published');
    expect(unchanged?.version).toBe(4);
    expect(unchanged?.updatedAt).toEqual(page!.updatedAt);
    await expect(cmsPageService.seedPages([{ ...seed[0], data: { root: { props: {} }, content: [] } }])).rejects.toMatchObject({ code: 'CMS_CONTENT_INVALID' });
  });
});
