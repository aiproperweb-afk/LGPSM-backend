import mongoose, { Document, Schema } from 'mongoose';

/**
 * A one-time code waiting to be entered, for a mobile number or a new email address. One per `key` (what is being proved, for whom):
 * a new code replaces the old one. Only the bcrypt hash is stored, and MongoDB removes the record when it expires.
 */
export const CODE_LENGTH = 6;
export const CODE_EXPIRY_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_RESEND_COOLDOWN_SECONDS = 60;
/** The most text messages one number is sent in an hour, whoever asks */
export const MAX_SMS_PER_NUMBER_PER_HOUR = 5;

export interface IVerificationCode extends Document {
  key: string;
  /** the number (digits) or email address the code was sent to */
  target: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lastSentAt: Date;
}

const VerificationCodeSchema = new Schema<IVerificationCode>({
  key: { type: String, required: true, unique: true },
  target: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, required: true },
});

export const VerificationCode = mongoose.model<IVerificationCode>('VerificationCode', VerificationCodeSchema);

/** One row per text message sent, kept for an hour: bounds what one number can be sent */
const SmsSendSchema = new Schema({ phone: { type: String, required: true, index: true }, createdAt: { type: Date, default: Date.now, expires: 3600 } });

export const SmsSend = mongoose.model('SmsSend', SmsSendSchema);
