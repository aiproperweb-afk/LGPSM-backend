"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationCodeService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const VerificationCode_1 = require("../models/VerificationCode");
const sms_service_1 = require("./sms.service");
const newCode = () => crypto_1.default.randomInt(0, 10 ** VerificationCode_1.CODE_LENGTH).toString().padStart(VerificationCode_1.CODE_LENGTH, '0');
/**
 * Makes a code for `key`, hands it to `deliver` and stores it only once it was delivered, so a failed send leaves any earlier code
 * working. A second request inside the cooldown (for the same place) is refused with 429.
 */
async function issue(key, target, deliver) {
    const earlier = await VerificationCode_1.VerificationCode.findOne({ key });
    if (earlier && earlier.target === target) {
        const wait = Math.ceil((earlier.lastSentAt.getTime() + VerificationCode_1.CODE_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
        if (wait > 0) {
            throw { statusCode: 429, code: 'CODE_COOLDOWN', message: `Please wait ${wait} second${wait === 1 ? '' : 's'} before asking for another code.`, secondsRemaining: wait };
        }
    }
    const code = newCode();
    const codeHash = await bcrypt_1.default.hash(code, 10);
    await deliver(code);
    const now = new Date();
    await VerificationCode_1.VerificationCode.findOneAndUpdate({ key }, { key, target, codeHash, expiresAt: new Date(now.getTime() + VerificationCode_1.CODE_EXPIRY_MINUTES * 60 * 1000), attempts: 0, lastSentAt: now }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
exports.verificationCodeService = {
    issue,
    /** A code by text message to `phone` (normalised digits) */
    async sendSms(key, phone) {
        if (!sms_service_1.smsService.isConfigured()) {
            throw { statusCode: 503, code: 'SMS_NOT_CONFIGURED', exposeMessage: true, message: 'Mobile verification is not available yet.' };
        }
        if ((await VerificationCode_1.SmsSend.countDocuments({ phone, createdAt: { $gt: new Date(Date.now() - 3600_000) } })) >= VerificationCode_1.MAX_SMS_PER_NUMBER_PER_HOUR) {
            throw { statusCode: 429, code: 'SMS_LIMIT', message: 'Too many codes have been sent to this number. Please try again in an hour.' };
        }
        await issue(key, phone, async (code) => {
            try {
                await sms_service_1.smsService.sendOtp(phone, code);
            }
            catch {
                throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the text message. Please try again later.' };
            }
            await VerificationCode_1.SmsSend.create({ phone });
        });
    },
    /**
     * Checks a typed code and uses it up when right; returns where it had been sent. The attempt is counted before the comparison, in
     * one database step, so requests sent together cannot get more guesses.
     */
    async consume(key, code) {
        const record = await VerificationCode_1.VerificationCode.findOneAndUpdate({ key, expiresAt: { $gt: new Date() }, attempts: { $lt: VerificationCode_1.MAX_CODE_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
        if (!record)
            throw { statusCode: 400, code: 'CODE_EXPIRED', message: 'This code is no longer valid. Please ask for a new one.' };
        if (!(await bcrypt_1.default.compare(code, record.codeHash))) {
            const left = VerificationCode_1.MAX_CODE_ATTEMPTS - record.attempts;
            throw {
                statusCode: 400,
                code: 'CODE_INCORRECT',
                message: left > 0 ? `Invalid verification code. ${left} attempt${left === 1 ? '' : 's'} remaining.` : 'Invalid verification code. Please ask for a new one.',
            };
        }
        await VerificationCode_1.VerificationCode.deleteOne({ _id: record._id });
        return record.target;
    },
    async discard(key) {
        await VerificationCode_1.VerificationCode.deleteOne({ key });
    },
};
