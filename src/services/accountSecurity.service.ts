/**
 * Proving who owns a mobile number or an email address: the sign-up's mobile step, verifying the number from the profile, changing
 * the sign-in email, and the "Can't access your account?" options.
 */
import { AuthProvider, IUser, Role, User } from '../models/User';
import { userRepository } from '../repositories/user.repository';
import { escapeHtml } from '../utils/html';
import { sendEmail } from '../utils/email.provider';
import { verifyPassword } from '../utils/password';
import { securityEvent } from '../utils/securityLog';
import { contactService, ContactRequestMeta } from './contact.service';
import { smsService } from './sms.service';
import { verificationCodeService } from './verificationCode.service';
import { normalizePhoneNumber } from './whatsapp.service';

const signupKey = (userId: unknown) => `signup-phone:${String(userId)}`;
const profileKey = (userId: unknown) => `profile-phone:${String(userId)}`;
const findKey = (phone: string) => `find-account:${phone}`;
const emailKey = (userId: unknown) => `change-email:${String(userId)}`;
const verifyEmailKey = (userId: unknown) => `verify-email:${String(userId)}`;

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};

/** The organizer sign-up still waiting for its mobile code, if this email has one */
async function pendingPhoneSignup(email: string): Promise<IUser | null> {
  const user = await userRepository.findByRoleAndEmail(email.trim().toLowerCase(), Role.ORGANIZER);
  return user && user.phoneVerificationRequired && !user.isPhoneVerified ? user : null;
}

const markPhoneVerified = (userId: unknown, phone: string) =>
  // only if the number is still the one the code went to
  User.updateOne({ _id: userId, phone }, { $set: { isPhoneVerified: true, phoneVerificationRequired: false } });

async function me(userId: string): Promise<IUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw { statusCode: 404, message: 'User not found' };
  return user;
}

async function emailTaken(email: string, userId: string): Promise<boolean> {
  return !!(await User.exists({ _id: { $ne: userId }, email, role: { $in: [Role.ORGANIZER, Role.ADMIN] } }));
}
const TAKEN = { statusCode: 409, code: 'EMAIL_IN_USE', message: 'This email address is already used by another account.' };

export const accountSecurityService = {
  // ─── the sign-up's mobile step (not signed in yet: identified by the sign-up's email) ─────────────

  async resendSignupPhoneCode(email: string) {
    const user = await pendingPhoneSignup(email);
    if (user?.phone) await verificationCodeService.sendSms(signupKey(user._id), user.phone);
    return { sent: true as const };
  },

  async verifySignupPhone(email: string, code: string) {
    const user = await pendingPhoneSignup(email);
    if (!user) throw { statusCode: 400, code: 'CODE_EXPIRED', message: 'This code is no longer valid. Please ask for a new one.' };
    const phone = await verificationCodeService.consume(signupKey(user._id), code);
    await markPhoneVerified(user._id, phone);
    return { verified: true as const };
  },

  /** A mistyped number at sign-up: the password chosen there proves the request comes from the same person */
  async changePendingPhone(data: { email: string; password: string; phone: string }) {
    const user = await pendingPhoneSignup(data.email);
    if (!user || !(await verifyPassword(data.password, user.passwordHash ?? ''))) {
      throw { statusCode: 401, message: 'We could not change the mobile number. Check the details and try again.' };
    }
    const phone = normalizePhoneNumber(data.phone);
    if (phone === user.phone) throw { statusCode: 400, message: 'Enter a different mobile number.' };
    // the code is sent first: if it cannot be, the sign-up stays as it was
    await verificationCodeService.sendSms(signupKey(user._id), phone);
    await userRepository.updateById(String(user._id), { phone } as any);
    return { phone };
  },

  // ─── signed in: verify the number on the profile ─────────────────────────────

  async sendProfilePhoneCode(userId: string) {
    const user = await me(userId);
    if (!user.phone) throw { statusCode: 400, message: 'Add a mobile number to your profile first.' };
    if (user.isPhoneVerified) throw { statusCode: 400, message: 'This mobile number is already verified.' };
    await verificationCodeService.sendSms(profileKey(userId), user.phone);
    return { sent: true as const };
  },

  async verifyProfilePhone(userId: string, code: string) {
    const phone = await verificationCodeService.consume(profileKey(userId), code);
    const result = await markPhoneVerified(userId, phone);
    if (!result.matchedCount) throw { statusCode: 400, message: 'The mobile number changed after the code was sent. Please ask for a new code.' };
    return { verified: true as const };
  },

  // ─── signed in: verify the sign-in email (an account an administrator created) ───

  async sendProfileEmailCode(userId: string) {
    const user = await me(userId);
    if (!user.adminCreated || user.emailConfirmedAt) throw { statusCode: 400, message: 'This email address is already verified.' };
    await verificationCodeService.issue(verifyEmailKey(userId), user.email, async (code) => {
      try {
        await sendEmail(
          user.email,
          'Verify your email address',
          `<p>Hello ${escapeHtml(user.fullName)},</p><p>Use this code to verify the email address of your EventQRapp account. It expires in 10 minutes.</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>If you did not ask for this, you can ignore this email.</p>`
        );
      } catch (error) {
        console.error('Email verification code could not be sent:', (error as Error).message);
        throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the verification email. Please try again later.' };
      }
    });
    return { sentTo: user.email };
  },

  async verifyProfileEmail(userId: string, code: string) {
    const address = await verificationCodeService.consume(verifyEmailKey(userId), code);
    const result = await User.updateOne({ _id: userId, email: address }, { $set: { isEmailVerified: true, emailConfirmedAt: new Date() } });
    if (!result.matchedCount) throw { statusCode: 400, message: 'The email address changed after the code was sent. Please ask for a new code.' };
    return { verified: true as const };
  },

  // ─── signed in: change the sign-in email ───────────────────────────────────

  /** Step 1: the password, then a code to the new address. Nothing changes until that code is entered. */
  async requestEmailChange(userId: string, data: { newEmail: string; password: string }) {
    const user = await me(userId);
    if (user.authProvider === AuthProvider.GOOGLE || !user.passwordHash) {
      throw { statusCode: 400, code: 'GOOGLE_ACCOUNT', message: 'This account signs in with Google, so its email address is the Google one and cannot be changed here.' };
    }
    if (!(await verifyPassword(data.password, user.passwordHash))) throw { statusCode: 400, code: 'WRONG_PASSWORD', message: 'Current password is incorrect' };
    const next = data.newEmail.trim().toLowerCase();
    if (next === user.email) throw { statusCode: 400, message: 'Enter a different email address.' };
    if (await emailTaken(next, userId)) throw TAKEN;
    await verificationCodeService.issue(emailKey(userId), next, async (code) => {
      try {
        await sendEmail(
          next,
          'Confirm your new email address',
          `<p>Hello ${escapeHtml(user.fullName)},</p><p>Use this code to make this the sign-in email of your EventQRapp account. It expires in 10 minutes.</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>If you did not ask for this, you can ignore this email.</p>`
        );
      } catch (error) {
        console.error('Email change code could not be sent:', (error as Error).message);
        throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the verification email. Please try again later.' };
      }
    });
    return { sentTo: next };
  },

  /** Step 2: the code from the new address makes it the sign-in email; the old address is told */
  async confirmEmailChange(userId: string, code: string) {
    const user = await me(userId);
    const next = await verificationCodeService.consume(emailKey(userId), code);
    if (await emailTaken(next, userId)) throw TAKEN;
    const previous = user.email;
    try {
      // a linked Google sign-in belonged to the old address
      await User.updateOne({ _id: userId }, { $set: { email: next, isEmailVerified: true, emailConfirmedAt: new Date() }, $unset: { googleId: 1 } });
    } catch (error: any) {
      if (error?.code === 11000) throw TAKEN;
      throw error;
    }
    securityEvent('EMAIL_CHANGED', undefined, { subject: userId });
    void sendEmail(
      previous,
      'Your sign-in email was changed',
      `<p>Hello ${escapeHtml(user.fullName)},</p><p>The sign-in email of your EventQRapp account was changed to ${escapeHtml(maskEmail(next))}. If this was not you, contact support at once.</p>`
    ).catch((error) => console.error('Email change notice could not be sent:', (error as Error).message));
    return { email: next };
  },

  // ─── "Can't access your account?" ─────────────────────────────────────────────

  /** Forgot email, step 1: a code to the mobile number. The answer is the same whether or not an account uses it. */
  async sendFindAccountCode(rawPhone: string) {
    if (!smsService.isConfigured()) {
      throw { statusCode: 503, code: 'SMS_NOT_CONFIGURED', exposeMessage: true, message: 'Finding an account by mobile number is not available yet. Please contact support.' };
    }
    const phone = normalizePhoneNumber(rawPhone);
    if (await User.exists({ phone, role: Role.ORGANIZER, isActive: true })) {
      await verificationCodeService.sendSms(findKey(phone), phone).catch((error) => console.error('Account finder code was not sent:', error?.message));
    }
    return { sent: true as const };
  },

  /**
   * Forgot email, step 2: with the code, the email addresses on that number. A number the account holder has verified shows the whole
   * address; one never verified (it could have been mistyped) shows it only in part.
   */
  async findAccounts(rawPhone: string, code: string) {
    const phone = normalizePhoneNumber(rawPhone);
    await verificationCodeService.consume(findKey(phone), code);
    const users = await User.find({ phone, role: Role.ORGANIZER, isActive: true }).select('email isPhoneVerified').lean();
    return { accounts: users.map((u: any) => ({ email: u.isPhoneVerified ? u.email : maskEmail(u.email), complete: !!u.isPhoneVerified })) };
  },

  /**
   * Lost access to the email: nothing changes automatically. The request goes to the administrators, who check who is asking before
   * touching the account. The answer never says whether the account exists.
   */
  async requestEmailRecovery(data: { email: string; recoveryEmail: string }, meta: ContactRequestMeta) {
    const email = data.email.trim().toLowerCase();
    const known = await userRepository.findByRoleAndEmail(email, Role.ORGANIZER);
    await contactService.submit(
      {
        name: 'Account recovery request',
        email: data.recoveryEmail.trim().toLowerCase(),
        message: `Lost access to the sign-in email.\nAccount email given: ${email}\nOrganizer account with that email: ${known ? `yes (${known.fullName})` : 'no'}\nReply address given: ${data.recoveryEmail}\nConfirm the person's identity before changing anything.`,
      },
      meta
    );
    return { received: true as const };
  },
};
