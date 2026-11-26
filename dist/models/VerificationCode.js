"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsSend = exports.VerificationCode = exports.MAX_SMS_PER_NUMBER_PER_HOUR = exports.CODE_RESEND_COOLDOWN_SECONDS = exports.MAX_CODE_ATTEMPTS = exports.CODE_EXPIRY_MINUTES = exports.CODE_LENGTH = void 0;
const mongoose_1 = __importStar(require("mongoose"));
/**
 * A one-time code waiting to be entered, for a mobile number or a new email address. One per `key` (what is being proved, for whom):
 * a new code replaces the old one. Only the bcrypt hash is stored, and MongoDB removes the record when it expires.
 */
exports.CODE_LENGTH = 6;
exports.CODE_EXPIRY_MINUTES = 10;
exports.MAX_CODE_ATTEMPTS = 5;
exports.CODE_RESEND_COOLDOWN_SECONDS = 60;
/** The most text messages one number is sent in an hour, whoever asks */
exports.MAX_SMS_PER_NUMBER_PER_HOUR = 5;
const VerificationCodeSchema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
});
exports.VerificationCode = mongoose_1.default.model('VerificationCode', VerificationCodeSchema);
/** One row per text message sent, kept for an hour: bounds what one number can be sent */
const SmsSendSchema = new mongoose_1.Schema({ phone: { type: String, required: true, index: true }, createdAt: { type: Date, default: Date.now, expires: 3600 } });
exports.SmsSend = mongoose_1.default.model('SmsSend', SmsSendSchema);
