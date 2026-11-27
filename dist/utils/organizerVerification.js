"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationMessage = void 0;
exports.verificationPending = verificationPending;
const User_1 = require("../models/User");
const sms_service_1 = require("../services/sms.service");
/** What this account still has to verify, or null when nothing. The mobile number is only asked for while text messages can be sent. */
function verificationPending(user) {
    if (!user || user.role !== User_1.Role.ORGANIZER || !user.adminCreated)
        return null;
    const pending = { email: !user.emailConfirmedAt, phone: !user.isPhoneVerified && sms_service_1.smsService.isConfigured() };
    return pending.email || pending.phone ? pending : null;
}
const verificationMessage = (pending) => `Verify your ${[pending.email ? 'email address' : '', pending.phone ? 'mobile number' : ''].filter(Boolean).join(' and ')} in Account Settings before creating events or sending invitations.`;
exports.verificationMessage = verificationMessage;
