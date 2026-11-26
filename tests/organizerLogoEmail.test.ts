/**
 * The top of the invitation email carries no logo and no organizer name, whatever the organizer has saved on their profile, and no logo
 * is attached (an unused inline picture would show as a loose attachment). Goes through the real routes the Settings page uses (upload,
 * then save the profile). Mail is mocked: nothing is sent.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User, Role } from '../src/models/User';
import { Event } from '../src/models/Event';
import { Invitee } from '../src/models/Invitee';
import { Invitation, DeliveryChannel } from '../src/models/Invitation';
import { Category } from '../src/models/Category';
import { invitationService } from '../src/services/invitation.service';
import { generateAccessToken } from '../src/utils/token';

const mockSendEmail = jest.fn().mockResolvedValue(true);
jest.mock('../src/utils/email.provider', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }));
jest.setTimeout(90000);

let mongo: MongoMemoryServer; let org: any; let event: any;
const auth = () => ({ Authorization: `Bearer ${generateAccessToken(String(org._id), org.role)}` });
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  mockSendEmail.mockClear();
  await Promise.all([User.deleteMany({}), Event.deleteMany({}), Invitee.deleteMany({}), Invitation.deleteMany({}), Category.deleteMany({})]);
  org = await User.create({ fullName: 'Rina Das', email: 'org@x.com', role: Role.ORGANIZER, isActive: true, isEmailVerified: true, profile: { organizationName: 'Iconic Events' } });
  const cat = await Category.create({ name: 'Corporate', isActive: true });
  event = await Event.create({ organizerId: org._id, title: 'Summit', description: 'd', categoryId: cat._id, format: 'PHYSICAL', status: 'PUBLISHED', contactNumber: '9007000891', location: { address: 'Kolkata' }, schedule: { start: new Date(Date.now() + 864e5), end: new Date(Date.now() + 2 * 864e5) } });
});

const sendOne = async (email: string) => {
  const g: any = await Invitee.create({ eventId: event._id, name: 'Guest', email, sessionAccess: [] });
  mockSendEmail.mockClear();
  await invitationService.sendInvitations(String(event._id), String(org._id), [String(g._id)], DeliveryChannel.EMAIL);
  const [, , html, attachments] = mockSendEmail.mock.calls[0];
  return { html: html as string, attachments: attachments as any[], id: String(g._id) };
};

describe('the top of the invitation email', () => {
  it('has no logo, organizer name or logo attachment, even after a logo is uploaded', async () => {
    const logo = await sharp({ create: { width: 240, height: 120, channels: 3, background: '#123C8F' } }).png().toBuffer();
    const up = await request(app).post('/api/v1/media/upload').set(auth()).field('purpose', 'ORGANIZATION_LOGO').attach('file', logo, { filename: 'logo.png', contentType: 'image/png' });
    expect(up.status).toBeLessThan(300);
    const saved = await request(app).patch('/api/users/profile').set(auth()).send({ profile: { organizationName: 'Iconic Events', logoKey: up.body.data.key } });
    expect(saved.status).toBe(200);

    const e = await sendOne('first@x.com');
    const top = e.html.slice(e.html.indexOf('class="sheet"'), e.html.indexOf('<h1'));
    expect(top).not.toContain('<img');
    expect(top).not.toContain('Iconic Events');
    expect(e.html).not.toContain('cid:organizer-logo-');
    expect(e.html).not.toContain('cid:lgpsm-logo');
    expect(e.attachments.some((a) => String(a.cid).startsWith('organizer-logo-') || a.cid === 'lgpsm-logo')).toBe(false);
    // the guest is named under the headline; their address is not shown
    expect(e.html).toContain('>Guest</td>');
    expect(e.html).not.toContain('first@x.com');
    // the organizer is still named further down
    expect(e.html).toContain('Organized by <strong>Iconic Events</strong>');
  });
});
