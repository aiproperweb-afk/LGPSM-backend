"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireVerifiedOrganizer = requireVerifiedOrganizer;
const User_1 = require("../models/User");
const organizerVerification_1 = require("../utils/organizerVerification");
/** Stops an organizer who has still to verify their account (utils/organizerVerification.ts). Administrators acting for them are not stopped. */
async function requireVerifiedOrganizer(req, res, next) {
    try {
        const actor = req.user;
        if (actor?.role !== 'ORGANIZER')
            return next();
        const pending = (0, organizerVerification_1.verificationPending)(await User_1.User.findById(actor.userId).select('role adminCreated emailConfirmedAt isPhoneVerified').lean());
        if (!pending)
            return next();
        return res.status(403).json({ success: false, code: 'VERIFICATION_REQUIRED', error: 'Forbidden', message: (0, organizerVerification_1.verificationMessage)(pending), pending });
    }
    catch (error) {
        return next(error);
    }
}
