import bcrypt from 'bcrypt';
import crypto from 'crypto';
import {
  CODE_EXPIRY_MINUTES,
  CODE_LENGTH,
  CODE_RESEND_COOLDOWN_SECONDS,
  MAX_CODE_ATTEMPTS,
  MAX_SMS_PER_NUMBER_PER_HOUR,
  SmsSend,
  VerificationCode,
} from '../models/VerificationCode';
import { smsService } from './sms.service';

const newCode = () => crypto.randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');

/**
 * Makes a code for `key`, hands it to `deliver` and stores it only once it was delivered, so a failed send leaves any earlier code
 * working. A second request inside the cooldown (for the same place) is refused with 429.
 */
async function issue(key: string, target: string, deliver: (code: string) => Promise<unknown>) {
  const earlier = await VerificationCode.findOne({ key });
  if (earlier && earlier.target === target) {
    const wait = Math.ceil((earlier.lastSentAt.getTime() + CODE_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) {
      throw { statusCode: 429, code: 'CODE_COOLDOWN', message: `Please wait ${wait} second${wait === 1 ? '' : 's'} before asking for another code.`, secondsRemaining: wait };
    }
  }
  const code = newCode();
  const codeHash = await bcrypt.hash(code, 10);
  await deliver(code);
  const now = new Date();
  await VerificationCode.findOneAndUpdate(
    { key },
    { key, target, codeHash, expiresAt: new Date(now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000), attempts: 0, lastSentAt: now },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export const verificationCodeService = {
  issue,

  /** A code by text message to `phone` (normalised digits) */
  async sendSms(key: string, phone: string) {
    if (!smsService.isConfigured()) {
      throw { statusCode: 503, code: 'SMS_NOT_CONFIGURED', exposeMessage: true, message: 'Mobile verification is not available yet.' };
    }
    if ((await SmsSend.countDocuments({ phone, createdAt: { $gt: new Date(Date.now() - 3600_000) } })) >= MAX_SMS_PER_NUMBER_PER_HOUR) {
      throw { statusCode: 429, code: 'SMS_LIMIT', message: 'Too many codes have been sent to this number. Please try again in an hour.' };
    }
    await issue(key, phone, async (code) => {
      try {
        await smsService.sendOtp(phone, code);
      } catch {
        throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the text message. Please try again later.' };
      }
      await SmsSend.create({ phone });
    });
  },

  /**
   * Checks a typed code and uses it up when right; returns where it had been sent. The attempt is counted before the comparison, in
   * one database step, so requests sent together cannot get more guesses.
   */
  async consume(key: string, code: string): Promise<string> {
    const record = await VerificationCode.findOneAndUpdate(
      { key, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_CODE_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!record) throw { statusCode: 400, code: 'CODE_EXPIRED', message: 'This code is no longer valid. Please ask for a new one.' };
    if (!(await bcrypt.compare(code, record.codeHash))) {
      const left = MAX_CODE_ATTEMPTS - record.attempts;
      throw {
        statusCode: 400,
        code: 'CODE_INCORRECT',
        message: left > 0 ? `Invalid verification code. ${left} attempt${left === 1 ? '' : 's'} remaining.` : 'Invalid verification code. Please ask for a new one.',
      };
    }
    await VerificationCode.deleteOne({ _id: record._id });
    return record.target;
  },

  async discard(key: string) {
    await VerificationCode.deleteOne({ key });
  },
};
