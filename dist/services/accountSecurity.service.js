"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountSecurityService = void 0;
/**
 * Proving who owns a mobile number or an email address: the sign-up's mobile step, verifying the number from the profile, changing
 * the sign-in email, and the "Can't access your account?" options.
 */
const User_1 = require("../models/User");
const user_repository_1 = require("../repositories/user.repository");
const html_1 = require("../utils/html");
const email_provider_1 = require("../utils/email.provider");
const password_1 = require("../utils/password");
const securityLog_1 = require("../utils/securityLog");
const contact_service_1 = require("./contact.service");
const sms_service_1 = require("./sms.service");
const verificationCode_service_1 = require("./verificationCode.service");
const whatsapp_service_1 = require("./whatsapp.service");
const signupKey = (userId) => `signup-phone:${String(userId)}`;
const profileKey = (userId) => `profile-phone:${String(userId)}`;
const findKey = (phone) => `find-account:${phone}`;
const emailKey = (userId) => `change-email:${String(userId)}`;
const verifyEmailKey = (userId) => `verify-email:${String(userId)}`;
const maskEmail = (email) => {
    const [name, domain] = email.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
};
/** The organizer sign-up still waiting for its mobile code, if this email has one */
async function pendingPhoneSignup(email) {
    const user = await user_repository_1.userRepository.findByRoleAndEmail(email.trim().toLowerCase(), User_1.Role.ORGANIZER);
    return user && user.phoneVerificationRequired && !user.isPhoneVerified ? user : null;
}
const markPhoneVerified = (userId, phone) => 
// only if the number is still the one the code went to
User_1.User.updateOne({ _id: userId, phone }, { $set: { isPhoneVerified: true, phoneVerificationRequired: false } });
async function me(userId) {
    const user = await user_repository_1.userRepository.findById(userId);
    if (!user)
        throw { statusCode: 404, message: 'User not found' };
    return user;
}
async function emailTaken(email, userId) {
    return !!(await User_1.User.exists({ _id: { $ne: userId }, email, role: { $in: [User_1.Role.ORGANIZER, User_1.Role.ADMIN] } }));
}
const TAKEN = { statusCode: 409, code: 'EMAIL_IN_USE', message: 'This email address is already used by another account.' };
exports.accountSecurityService = {
    // ─── the sign-up's mobile step (not signed in yet: identified by the sign-up's email) ─────────────
    async resendSignupPhoneCode(email) {
        const user = await pendingPhoneSignup(email);
        if (user?.phone)
            await verificationCode_service_1.verificationCodeService.sendSms(signupKey(user._id), user.phone);
        return { sent: true };
    },
    async verifySignupPhone(email, code) {
        const user = await pendingPhoneSignup(email);
        if (!user)
            throw { statusCode: 400, code: 'CODE_EXPIRED', message: 'This code is no longer valid. Please ask for a new one.' };
        const phone = await verificationCode_service_1.verificationCodeService.consume(signupKey(user._id), code);
        await markPhoneVerified(user._id, phone);
        return { verified: true };
    },
    /** A mistyped number at sign-up: the password chosen there proves the request comes from the same person */
    async changePendingPhone(data) {
        const user = await pendingPhoneSignup(data.email);
        if (!user || !(await (0, password_1.verifyPassword)(data.password, user.passwordHash ?? ''))) {
            throw { statusCode: 401, message: 'We could not change the mobile number. Check the details and try again.' };
        }
        const phone = (0, whatsapp_service_1.normalizePhoneNumber)(data.phone);
        if (phone === user.phone)
            throw { statusCode: 400, message: 'Enter a different mobile number.' };
        // the code is sent first: if it cannot be, the sign-up stays as it was
        await verificationCode_service_1.verificationCodeService.sendSms(signupKey(user._id), phone);
        await user_repository_1.userRepository.updateById(String(user._id), { phone });
        return { phone };
    },
    // ─── signed in: verify the number on the profile ─────────────────────────────
    async sendProfilePhoneCode(userId) {
        const user = await me(userId);
        if (!user.phone)
            throw { statusCode: 400, message: 'Add a mobile number to your profile first.' };
        if (user.isPhoneVerified)
            throw { statusCode: 400, message: 'This mobile number is already verified.' };
        await verificationCode_service_1.verificationCodeService.sendSms(profileKey(userId), user.phone);
        return { sent: true };
    },
    async verifyProfilePhone(userId, code) {
        const phone = await verificationCode_service_1.verificationCodeService.consume(profileKey(userId), code);
        const result = await markPhoneVerified(userId, phone);
        if (!result.matchedCount)
            throw { statusCode: 400, message: 'The mobile number changed after the code was sent. Please ask for a new code.' };
        return { verified: true };
    },
    // ─── signed in: verify the sign-in email (an account an administrator created) ───
    async sendProfileEmailCode(userId) {
        const user = await me(userId);
        if (!user.adminCreated || user.emailConfirmedAt)
            throw { statusCode: 400, message: 'This email address is already verified.' };
        await verificationCode_service_1.verificationCodeService.issue(verifyEmailKey(userId), user.email, async (code) => {
            try {
                await (0, email_provider_1.sendEmail)(user.email, 'Verify your email address', `<p>Hello ${(0, html_1.escapeHtml)(user.fullName)},</p><p>Use this code to verify the email address of your EventQRapp account. It expires in 10 minutes.</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>If you did not ask for this, you can ignore this email.</p>`);
            }
            catch (error) {
                console.error('Email verification code could not be sent:', error.message);
                throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the verification email. Please try again later.' };
            }
        });
        return { sentTo: user.email };
    },
    async verifyProfileEmail(userId, code) {
        const address = await verificationCode_service_1.verificationCodeService.consume(verifyEmailKey(userId), code);
        const result = await User_1.User.updateOne({ _id: userId, email: address }, { $set: { isEmailVerified: true, emailConfirmedAt: new Date() } });
        if (!result.matchedCount)
            throw { statusCode: 400, message: 'The email address changed after the code was sent. Please ask for a new code.' };
        return { verified: true };
    },
    // ─── signed in: change the sign-in email ───────────────────────────────────
    /** Step 1: the password, then a code to the new address. Nothing changes until that code is entered. */
    async requestEmailChange(userId, data) {
        const user = await me(userId);
        if (user.authProvider === User_1.AuthProvider.GOOGLE || !user.passwordHash) {
            throw { statusCode: 400, code: 'GOOGLE_ACCOUNT', message: 'This account signs in with Google, so its email address is the Google one and cannot be changed here.' };
        }
        if (!(await (0, password_1.verifyPassword)(data.password, user.passwordHash)))
            throw { statusCode: 400, code: 'WRONG_PASSWORD', message: 'Current password is incorrect' };
        const next = data.newEmail.trim().toLowerCase();
        if (next === user.email)
            throw { statusCode: 400, message: 'Enter a different email address.' };
        if (await emailTaken(next, userId))
            throw TAKEN;
        await verificationCode_service_1.verificationCodeService.issue(emailKey(userId), next, async (code) => {
            try {
                await (0, email_provider_1.sendEmail)(next, 'Confirm your new email address', `<p>Hello ${(0, html_1.escapeHtml)(user.fullName)},</p><p>Use this code to make this the sign-in email of your EventQRapp account. It expires in 10 minutes.</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>If you did not ask for this, you can ignore this email.</p>`);
            }
            catch (error) {
                console.error('Email change code could not be sent:', error.message);
                throw { statusCode: 503, exposeMessage: true, message: 'Unable to send the verification email. Please try again later.' };
            }
        });
        return { sentTo: next };
    },
    /** Step 2: the code from the new address makes it the sign-in email; the old address is told */
    async confirmEmailChange(userId, code) {
        const user = await me(userId);
        const next = await verificationCode_service_1.verificationCodeService.consume(emailKey(userId), code);
        if (await emailTaken(next, userId))
            throw TAKEN;
        const previous = user.email;
        try {
            // a linked Google sign-in belonged to the old address
            await User_1.User.updateOne({ _id: userId }, { $set: { email: next, isEmailVerified: true, emailConfirmedAt: new Date() }, $unset: { googleId: 1 } });
        }
        catch (error) {
            if (error?.code === 11000)
                throw TAKEN;
            throw error;
        }
        (0, securityLog_1.securityEvent)('EMAIL_CHANGED', undefined, { subject: userId });
        void (0, email_provider_1.sendEmail)(previous, 'Your sign-in email was changed', `<p>Hello ${(0, html_1.escapeHtml)(user.fullName)},</p><p>The sign-in email of your EventQRapp account was changed to ${(0, html_1.escapeHtml)(maskEmail(next))}. If this was not you, contact support at once.</p>`).catch((error) => console.error('Email change notice could not be sent:', error.message));
        return { email: next };
    },
    // ─── "Can't access your account?" ─────────────────────────────────────────────
    /** Forgot email, step 1: a code to the mobile number. The answer is the same whether or not an account uses it. */
    async sendFindAccountCode(rawPhone) {
        if (!sms_service_1.smsService.isConfigured()) {
            throw { statusCode: 503, code: 'SMS_NOT_CONFIGURED', exposeMessage: true, message: 'Finding an account by mobile number is not available yet. Please contact support.' };
        }
        const phone = (0, whatsapp_service_1.normalizePhoneNumber)(rawPhone);
        if (await User_1.User.exists({ phone, role: User_1.Role.ORGANIZER, isActive: true })) {
            await verificationCode_service_1.verificationCodeService.sendSms(findKey(phone), phone).catch((error) => console.error('Account finder code was not sent:', error?.message));
        }
        return { sent: true };
    },
    /**
     * Forgot email, step 2: with the code, the email addresses on that number. A number the account holder has verified shows the whole
     * address; one never verified (it could have been mistyped) shows it only in part.
     */
    async findAccounts(rawPhone, code) {
        const phone = (0, whatsapp_service_1.normalizePhoneNumber)(rawPhone);
        await verificationCode_service_1.verificationCodeService.consume(findKey(phone), code);
        const users = await User_1.User.find({ phone, role: User_1.Role.ORGANIZER, isActive: true }).select('email isPhoneVerified').lean();
        return { accounts: users.map((u) => ({ email: u.isPhoneVerified ? u.email : maskEmail(u.email), complete: !!u.isPhoneVerified })) };
    },
    /**
     * Lost access to the email: nothing changes automatically. The request goes to the administrators, who check who is asking before
     * touching the account. The answer never says whether the account exists.
     */
    async requestEmailRecovery(data, meta) {
        const email = data.email.trim().toLowerCase();
        const known = await user_repository_1.userRepository.findByRoleAndEmail(email, User_1.Role.ORGANIZER);
        await contact_service_1.contactService.submit({
            name: 'Account recovery request',
            email: data.recoveryEmail.trim().toLowerCase(),
            message: `Lost access to the sign-in email.\nAccount email given: ${email}\nOrganizer account with that email: ${known ? `yes (${known.fullName})` : 'no'}\nReply address given: ${data.recoveryEmail}\nConfirm the person's identity before changing anything.`,
        }, meta);
        return { received: true };
    },
};
