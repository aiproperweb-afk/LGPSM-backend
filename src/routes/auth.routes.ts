import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import {
  authRateLimiter,
  loginIpLimiter,
  loginAccountLimiter,
  refreshRateLimiter,
  verifyEmailRateLimiter,
  resendVerificationRateLimiter,
  changePendingEmailRateLimiter,
  phoneSendLimiter,
  phoneVerifyLimiter,
  recoveryLimiter,
} from '../middlewares/rateLimiter';
import {
  registerSchema,
  loginSchema,
  googleAuthSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  changePendingEmailSchema,
  verifyResetOtpSchema,
  signupPhoneSchema,
  verifySignupPhoneSchema,
  changePendingPhoneSchema,
  findAccountSchema,
  findAccountVerifySchema,
  lostEmailSchema,
} from '../validators/auth.validator';
import { Request, Response, NextFunction } from 'express';

const router = Router();

// Middleware to validate body using Zod
const validate = (schema: any) => (req: Request, res: Response, next: NextFunction) => {
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

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', loginIpLimiter, loginAccountLimiter, validate(loginSchema), authController.login);
router.post('/google', loginIpLimiter, validate(googleAuthSchema), authController.googleSignIn);
router.post('/refresh', refreshRateLimiter, validate(refreshTokenSchema), authController.refresh);
router.post('/logout', refreshRateLimiter, authController.logout);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
// Mobile reset flow: emailed 4-digit code → short-lived reset token (stricter limiters on top of authRateLimiter)
router.post(
  '/forgot-password/otp',
  authRateLimiter,
  resendVerificationRateLimiter,
  validate(forgotPasswordSchema),
  authController.requestPasswordResetOtp
);
router.post(
  '/forgot-password/verify-otp',
  authRateLimiter,
  verifyEmailRateLimiter,
  validate(verifyResetOtpSchema),
  authController.verifyPasswordResetOtp
);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

// Email verification — additional, stricter rate limiters on top of authRateLimiter
router.post(
  '/verify-email',
  authRateLimiter,
  verifyEmailRateLimiter,
  validate(verifyEmailSchema),
  authController.verifyEmail
);
// "Change email address" on the sign-up code page
router.post(
  '/change-pending-email',
  authRateLimiter,
  changePendingEmailRateLimiter,
  validate(changePendingEmailSchema),
  authController.changePendingEmail
);
router.post(
  '/resend-verification',
  authRateLimiter,
  resendVerificationRateLimiter,
  validate(resendVerificationSchema),
  authController.resendVerificationCode
);

// The sign-up's mobile step (before the account can sign in)
router.post('/phone/resend', phoneSendLimiter, validate(signupPhoneSchema), authController.resendSignupPhoneCode);
router.post('/phone/verify', phoneVerifyLimiter, validate(verifySignupPhoneSchema), authController.verifySignupPhone);
router.post('/change-pending-phone', phoneSendLimiter, changePendingEmailRateLimiter, validate(changePendingPhoneSchema), authController.changePendingPhone);

// "Can't access your account?"
router.post('/recovery/find-account', phoneSendLimiter, recoveryLimiter, validate(findAccountSchema), authController.sendFindAccountCode);
router.post('/recovery/find-account/verify', phoneVerifyLimiter, validate(findAccountVerifySchema), authController.findAccounts);
router.post('/recovery/lost-email', recoveryLimiter, validate(lostEmailSchema), authController.lostEmailAccess);

export default router;
