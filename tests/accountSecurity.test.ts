/**
 * Mobile verification, changing the sign-in email and "Can't access your account?". Email and text messages are mocked: nothing is
 * sent, and the codes are read from what would have been sent.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { User } from '../src/models/User';
import { EmailVerification } from '../src/models/EmailVerification';
import { SmsSend, VerificationCode } from '../src/models/VerificationCode';
import { ContactMessage } from '../src/models/ContactMessage';
import { hashPassword } from '../src/utils/password';
import { generateAccessToken } from '../src/utils/token';
import { smsService } from '../src/services/sms.service';

let mongoServer: MongoMemoryServer;
const mockSendEmail = jest.fn().mockResolvedValue(true);
jest.mock('../src/utils/email.provider', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }));

const texts: Array<{ phone: string; code: string }> = [];
let smsOn = true;
let smsFails = false;

const lastText = () => texts[texts.length - 1];
const emailCode = () => (mockSendEmail.mock.calls[mockSendEmail.mock.calls.length - 1][2] as string).match(/>\s*(\d{6})\s*</)![1];
const mailsTo = (to: string) => mockSendEmail.mock.calls.filter((c) => c[0] === to);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.syncIndexes(), VerificationCode.syncIndexes()]);
});
afterAll(async () => { await mongoose.disconnect(); await mongoServer.stop(); });
beforeEach(async () => {
  smsOn = true;
  smsFails = false;
  texts.length = 0;
  jest.spyOn(smsService, 'isConfigured').mockImplementation(() => smsOn);
  jest.spyOn(smsService, 'sendOtp').mockImplementation(async (phone, code) => {
    if (smsFails) throw new Error('FAILED_TO_SEND_SMS');
    texts.push({ phone, code });
  });
  mockSendEmail.mockClear();
  mockSendEmail.mockResolvedValue(true);
  await Promise.all([User.deleteMany({}), EmailVerification.deleteMany({}), VerificationCode.deleteMany({}), SmsSend.deleteMany({}), ContactMessage.deleteMany({})]);
});

const PASSWORD = 'StrongPass123!';
const form = { fullName: 'Rina Das', email: 'rina@example.com', password: PASSWORD, phone: '9876543210', role: 'ORGANIZER', channel: 'web' };
const signup = (over: object = {}) => request(app).post('/api/auth/register').send({ ...form, ...over });
const post = (path: string, body: object, token?: string) => {
  const r = request(app).post(path);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r.send(body);
};
const login = (email = form.email) => post('/api/auth/login', { email, password: PASSWORD });
const verifyEmail = () => post('/api/auth/verify-email', { email: form.email, code: emailCode() });

async function organizer(over: Record<string, unknown> = {}) {
  const user = await User.create({ fullName: 'Asha Rao', email: 'asha@example.com', phone: '919800000001', role: 'ORGANIZER', isActive: true, isEmailVerified: true, passwordHash: await hashPassword(PASSWORD), ...over });
  return { user, token: generateAccessToken(String(user._id), 'ORGANIZER' as any) };
}

describe('the mobile number at web sign-up', () => {
  it('is required on the web form, while older app sign-ups without it still work', async () => {
    expect((await signup({ phone: undefined })).status).toBe(400);
    expect((await signup({ phone: '12345' })).status).toBe(400);
    expect((await signup({ phone: undefined, channel: undefined })).status).toBe(201);
    expect(texts).toHaveLength(0);
  });

  it('is required and verified for a sign-up from the app too', async () => {
    expect((await signup({ channel: 'app', phone: undefined })).status).toBe(400);
    expect((await signup({ channel: 'app' })).body.data.phoneVerificationRequired).toBe(true);
    expect(lastText().phone).toBe('919876543210');
  });

  it('must be verified, as well as the email, before the first sign-in', async () => {
    const made = await signup({ marketingConsent: true });
    expect(made.body.data.phoneVerificationRequired).toBe(true);
    expect(lastText().phone).toBe('919876543210');
    const smsCode = lastText().code;

    const mailed = await verifyEmail();
    expect(mailed.body.data).toMatchObject({ verified: true, phoneVerificationRequired: true });
    const refused = await login();
    expect([refused.status, refused.body.message]).toEqual([403, 'PHONE_NOT_VERIFIED']);

    expect((await post('/api/auth/phone/verify', { email: form.email, code: smsCode === '000000' ? '111111' : '000000' })).status).toBe(400);
    expect((await post('/api/auth/phone/verify', { email: form.email, code: smsCode })).status).toBe(200);
    expect((await login()).status).toBe(200);
    const user: any = await User.findOne({ email: form.email });
    expect([user.isPhoneVerified, user.phoneVerificationRequired, user.marketingConsent]).toEqual([true, false, true]);
  });

  it('is not demanded when the server cannot send text messages', async () => {
    smsOn = false;
    expect((await signup()).body.data.phoneVerificationRequired).toBe(false);
    expect((await verifyEmail()).body.data.phoneVerificationRequired).toBe(false);
    expect((await login()).status).toBe(200);
    expect(((await User.findOne({ email: form.email })) as any).isPhoneVerified).toBe(false);
  });

  it('keeps the sign-up when the text cannot be sent, so the code can be asked for again', async () => {
    smsFails = true;
    expect((await signup()).status).toBe(201);
    smsFails = false;
    expect((await post('/api/auth/phone/resend', { email: form.email })).status).toBe(200);
    expect(texts).toHaveLength(1);
    // straight away again is refused, and an unknown address is answered without a text
    expect((await post('/api/auth/phone/resend', { email: form.email })).status).toBe(429);
    expect((await post('/api/auth/phone/resend', { email: 'nobody@example.com' })).status).toBe(200);
    expect(texts).toHaveLength(1);
  });

  it('can be corrected with the sign-up password; the old code then stops working', async () => {
    await signup();
    const old = lastText().code;
    expect((await post('/api/auth/change-pending-phone', { email: form.email, password: 'wrong-password', phone: '9123456789' })).status).toBe(401);
    expect((await post('/api/auth/change-pending-phone', { email: form.email, password: PASSWORD, phone: '9123456789' })).status).toBe(200);
    expect(lastText().phone).toBe('919123456789');
    if (old !== lastText().code) expect((await post('/api/auth/phone/verify', { email: form.email, code: old })).status).toBe(400);
    expect((await post('/api/auth/phone/verify', { email: form.email, code: lastText().code })).status).toBe(200);
  });

  it('allows five wrong codes and no more', async () => {
    await signup();
    const right = lastText().code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/phone/verify', { email: form.email, code: wrong })).status).toBe(400);
    expect((await post('/api/auth/phone/verify', { email: form.email, code: right })).status).toBe(400);
  });

  it('sends one number at most five texts an hour', async () => {
    await SmsSend.insertMany(Array.from({ length: 5 }, () => ({ phone: '919876543210' })));
    await signup();
    expect(texts).toHaveLength(0);
    expect((await post('/api/auth/phone/resend', { email: form.email })).status).toBe(429);
  });
});

describe('the number on the profile', () => {
  it('is verified with a code, and a changed number is unverified again', async () => {
    const { token } = await organizer();
    const profile = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`);
    expect(profile.body.data).toMatchObject({ isPhoneVerified: false, phoneVerificationAvailable: true });

    expect((await post('/api/users/me/phone/send', {}, token)).status).toBe(200);
    expect((await post('/api/users/me/phone/verify', { code: lastText().code }, token)).status).toBe(200);
    expect(((await User.findOne({ email: 'asha@example.com' })) as any).isPhoneVerified).toBe(true);

    const same = await request(app).patch('/api/users/profile').set('Authorization', `Bearer ${token}`).send({ phone: '9800000001' });
    expect(same.body.data.isPhoneVerified).toBe(true);
    const changed = await request(app).patch('/api/users/profile').set('Authorization', `Bearer ${token}`).send({ phone: '9800000002' });
    expect(changed.body.data.isPhoneVerified).toBe(false);
  });

  it('is not verified by a code sent to the number before it changed', async () => {
    const { token } = await organizer();
    await post('/api/users/me/phone/send', {}, token);
    const code = lastText().code;
    await request(app).patch('/api/users/profile').set('Authorization', `Bearer ${token}`).send({ phone: '9800000002' });
    expect((await post('/api/users/me/phone/verify', { code }, token)).status).toBe(400);
    expect(((await User.findOne({ email: 'asha@example.com' })) as any).isPhoneVerified).toBe(false);
  });
});

describe('changing the sign-in email', () => {
  it('needs the password and a code from the new address, then tells the old one', async () => {
    const { token } = await organizer({ googleId: 'g-123' });
    expect((await post('/api/users/me/email', { newEmail: 'new@example.com', password: 'wrong-password' }, token)).status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();

    const asked = await post('/api/users/me/email', { newEmail: 'New@Example.com', password: PASSWORD }, token);
    expect(asked.body.data).toEqual({ sentTo: 'new@example.com' });
    // nothing changes until the code is entered
    expect((await login('asha@example.com')).status).toBe(200);

    const code = emailCode();
    const done = await post('/api/users/me/email/confirm', { code }, token);
    expect(done.body.data).toEqual({ email: 'new@example.com' });
    expect((await login('new@example.com')).status).toBe(200);
    expect((await login('asha@example.com')).status).toBe(401);
    expect(((await User.findOne({ email: 'new@example.com' })) as any).googleId).toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(mailsTo('asha@example.com')).toHaveLength(1);
    expect((await post('/api/users/me/email/confirm', { code }, token)).status).toBe(400);
  });

  it('refuses an address another organizer or administrator uses, also if taken while the code was waiting', async () => {
    const { token } = await organizer();
    await User.create({ fullName: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: 'x' });
    expect((await post('/api/users/me/email', { newEmail: 'admin@example.com', password: PASSWORD }, token)).status).toBe(409);
    expect((await post('/api/users/me/email', { newEmail: 'later@example.com', password: PASSWORD }, token)).status).toBe(200);
    const code = emailCode();
    await User.create({ fullName: 'Other', email: 'later@example.com', role: 'ORGANIZER', passwordHash: 'x' });
    expect((await post('/api/users/me/email/confirm', { code }, token)).status).toBe(409);
    expect(await User.exists({ email: 'asha@example.com' })).toBeTruthy();
  });

  it('is not offered to a Google-only account, to staff, or without signing in', async () => {
    const google = await organizer({ authProvider: 'GOOGLE', passwordHash: undefined });
    const refused = await post('/api/users/me/email', { newEmail: 'new@example.com', password: 'anything-at-all' }, google.token);
    expect([refused.status, refused.body.code]).toEqual([400, 'GOOGLE_ACCOUNT']);
    const staff = await User.create({ fullName: 'Staff', email: 's@example.com', role: 'SYSTEM_USER', passwordHash: await hashPassword(PASSWORD) });
    expect((await post('/api/users/me/email', { newEmail: 'n@example.com', password: PASSWORD }, generateAccessToken(String(staff._id), 'SYSTEM_USER' as any))).status).toBe(403);
    expect((await post('/api/users/me/email', { newEmail: 'n@example.com', password: PASSWORD })).status).toBe(401);
  });

  it('keeps the profile endpoint from changing the email directly', async () => {
    const { token } = await organizer();
    expect((await request(app).patch('/api/users/profile').set('Authorization', `Bearer ${token}`).send({ email: 'x@example.com' })).status).toBe(400);
  });
});

describe('"Can\'t access your account?"', () => {
  it('finds an account by its mobile number only after a code sent to that number', async () => {
    await organizer({ isPhoneVerified: true });
    await organizer({ email: 'typo.person@example.com', isPhoneVerified: false });
    const known = await post('/api/auth/recovery/find-account', { phone: '9800000001' });
    const unknown = await post('/api/auth/recovery/find-account', { phone: '9000000000' });
    // the same answer either way, and a text only to a number an account uses
    expect(unknown.body).toEqual(known.body);
    expect(texts.map((t) => t.phone)).toEqual(['919800000001']);

    expect((await post('/api/auth/recovery/find-account/verify', { phone: '9000000000', code: lastText().code })).status).toBe(400);
    const found = await post('/api/auth/recovery/find-account/verify', { phone: '9800000001', code: lastText().code });
    expect(found.body.data.accounts).toEqual(expect.arrayContaining([
      { email: 'asha@example.com', complete: true },
      { email: 't***@example.com', complete: false },
    ]));
  });

  it('says it is unavailable without text messages', async () => {
    smsOn = false;
    const res = await post('/api/auth/recovery/find-account', { phone: '9800000001' });
    expect([res.status, res.body.code]).toEqual([503, 'SMS_NOT_CONFIGURED']);
  });

  it('passes a lost-email request to the administrators and changes nothing', async () => {
    await organizer();
    const known = await post('/api/auth/recovery/lost-email', { email: 'asha@example.com', recoveryEmail: 'spare@example.com' });
    const unknown = await post('/api/auth/recovery/lost-email', { email: 'nobody@example.com', recoveryEmail: 'spare2@example.com' });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(known.body).toEqual(unknown.body);
    const stored = await ContactMessage.find({}).sort({ createdAt: 1 }).lean();
    expect(stored.map((m) => m.email)).toEqual(['spare@example.com', 'spare2@example.com']);
    expect(stored[0].message).toContain('yes (Asha Rao)');
    expect(await User.exists({ email: 'asha@example.com' })).toBeTruthy();
    expect(mailsTo('spare@example.com')).toHaveLength(0);
    expect((await post('/api/auth/recovery/lost-email', { email: 'asha@example.com', recoveryEmail: 'asha@example.com' })).status).toBe(400);
  });
});
