"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const rateLimiter_1 = require("../middlewares/rateLimiter");
const auth_validator_1 = require("../validators/auth.validator");
const router = (0, express_1.Router)();
// Middleware to validate body using Zod
const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ success: false, errors: result.error.format() });
    }
    req.body = result.data;
    next();
};
// Apply the base auth rate limiter to all routes in this router
// Tokens and reset codes travel in these answers: nothing may keep a copy
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.post('/register', rateLimiter_1.authRateLimiter, validate(auth_validator_1.registerSchema), auth_controller_1.authController.register);
router.post('/login', rateLimiter_1.loginIpLimiter, rateLimiter_1.loginAccountLimiter, validate(auth_validator_1.loginSchema), auth_controller_1.authController.login);
router.post('/google', rateLimiter_1.loginIpLimiter, validate(auth_validator_1.googleAuthSchema), auth_controller_1.authController.googleSignIn);
router.post('/refresh', rateLimiter_1.refreshRateLimiter, validate(auth_validator_1.refreshTokenSchema), auth_controller_1.authController.refresh);
router.post('/logout', rateLimiter_1.refreshRateLimiter, auth_controller_1.authController.logout);
router.post('/forgot-password', rateLimiter_1.authRateLimiter, validate(auth_validator_1.forgotPasswordSchema), auth_controller_1.authController.forgotPassword);
// Mobile reset flow: emailed 4-digit code → short-lived reset token (stricter limiters on top of authRateLimiter)
router.post('/forgot-password/otp', rateLimiter_1.authRateLimiter, rateLimiter_1.resendVerificationRateLimiter, validate(auth_validator_1.forgotPasswordSchema), auth_controller_1.authController.requestPasswordResetOtp);
router.post('/forgot-password/verify-otp', rateLimiter_1.authRateLimiter, rateLimiter_1.verifyEmailRateLimiter, validate(auth_validator_1.verifyResetOtpSchema), auth_controller_1.authController.verifyPasswordResetOtp);
router.post('/reset-password', rateLimiter_1.authRateLimiter, validate(auth_validator_1.resetPasswordSchema), auth_controller_1.authController.resetPassword);
// Email verification — additional, stricter rate limiters on top of authRateLimiter
router.post('/verify-email', rateLimiter_1.authRateLimiter, rateLimiter_1.verifyEmailRateLimiter, validate(auth_validator_1.verifyEmailSchema), auth_controller_1.authController.verifyEmail);
// "Change email address" on the sign-up code page
router.post('/change-pending-email', rateLimiter_1.authRateLimiter, rateLimiter_1.changePendingEmailRateLimiter, validate(auth_validator_1.changePendingEmailSchema), auth_controller_1.authController.changePendingEmail);
router.post('/resend-verification', rateLimiter_1.authRateLimiter, rateLimiter_1.resendVerificationRateLimiter, validate(auth_validator_1.resendVerificationSchema), auth_controller_1.authController.resendVerificationCode);
// The sign-up's mobile step (before the account can sign in)
router.post('/phone/resend', rateLimiter_1.phoneSendLimiter, validate(auth_validator_1.signupPhoneSchema), auth_controller_1.authController.resendSignupPhoneCode);
router.post('/phone/verify', rateLimiter_1.phoneVerifyLimiter, validate(auth_validator_1.verifySignupPhoneSchema), auth_controller_1.authController.verifySignupPhone);
router.post('/change-pending-phone', rateLimiter_1.phoneSendLimiter, rateLimiter_1.changePendingEmailRateLimiter, validate(auth_validator_1.changePendingPhoneSchema), auth_controller_1.authController.changePendingPhone);
// "Can't access your account?"
router.post('/recovery/find-account', rateLimiter_1.phoneSendLimiter, rateLimiter_1.recoveryLimiter, validate(auth_validator_1.findAccountSchema), auth_controller_1.authController.sendFindAccountCode);
router.post('/recovery/find-account/verify', rateLimiter_1.phoneVerifyLimiter, validate(auth_validator_1.findAccountVerifySchema), auth_controller_1.authController.findAccounts);
router.post('/recovery/lost-email', rateLimiter_1.recoveryLimiter, validate(auth_validator_1.lostEmailSchema), auth_controller_1.authController.lostEmailAccess);
exports.default = router;
