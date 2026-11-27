import { NextFunction, Request, Response } from 'express';
import { User } from '../models/User';
import { verificationMessage, verificationPending } from '../utils/organizerVerification';

/** Stops an organizer who has still to verify their account (utils/organizerVerification.ts). Administrators acting for them are not stopped. */
export async function requireVerifiedOrganizer(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = (req as any).user;
    if (actor?.role !== 'ORGANIZER') return next();
    const pending = verificationPending(await User.findById(actor.userId).select('role adminCreated emailConfirmedAt isPhoneVerified').lean<any>());
    if (!pending) return next();
    return res.status(403).json({ success: false, code: 'VERIFICATION_REQUIRED', error: 'Forbidden', message: verificationMessage(pending), pending });
  } catch (error) {
    return next(error);
  }
}
