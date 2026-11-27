"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizerEraseService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = require("../models/User");
const Event_1 = require("../models/Event");
const Invitee_1 = require("../models/Invitee");
const CheckIn_1 = require("../models/CheckIn");
const Invoice_1 = require("../models/Invoice");
const Order_1 = require("../models/Order");
const Payment_1 = require("../models/Payment");
const TicketTier_1 = require("../models/TicketTier");
const CardDownloadPlan_1 = require("../models/CardDownloadPlan");
const Template_1 = require("../models/Template");
const TemplateGenerationJob_1 = require("../models/TemplateGenerationJob");
const Category_1 = require("../models/Category");
const Notification_1 = require("../models/Notification");
const RefreshToken_1 = require("../models/RefreshToken");
const VerificationCode_1 = require("../models/VerificationCode");
const EmailVerification_1 = require("../models/EmailVerification");
const PasswordResetOtp_1 = require("../models/PasswordResetOtp");
const IdempotencyKey_1 = require("../models/IdempotencyKey");
const SystemUserAssignment_1 = require("../models/SystemUserAssignment");
const mediaStorage_1 = require("./mediaStorage");
const billing_service_1 = require("./billing.service");
const auditLog_service_1 = require("./auditLog.service");
const event_service_1 = require("./event.service");
// "Delete organizer": the account and everything that belongs to it is erased and cannot be brought back. (Deactivating, which only
// stops the account signing in, is the reversible choice.) The audit trail is kept: it records that the erasure happened.
const notFound = () => Object.assign(new Error('Organizer not found'), { statusCode: 404 });
async function organizerOr404(organizerId) {
    if (!mongoose_1.default.Types.ObjectId.isValid(organizerId))
        throw notFound();
    const user = await User_1.User.findOne({ _id: organizerId, role: User_1.Role.ORGANIZER });
    if (!user)
        throw notFound();
    return user;
}
/** The organizer's own staff who work nobody else's events: they go with the organizer. Anyone also on another event is kept. */
async function staffToErase(organizerId, eventIds) {
    const mine = (await User_1.User.find({ role: User_1.Role.SYSTEM_USER, createdBy: organizerId }).distinct('_id'));
    if (!mine.length)
        return [];
    const elsewhere = new Set((await SystemUserAssignment_1.SystemUserAssignment.find({ userId: { $in: mine }, eventId: { $nin: eventIds } }).distinct('userId')).map(String));
    return mine.filter((id) => !elsewhere.has(String(id)));
}
exports.organizerEraseService = {
    /** What deleting would erase, for the warning shown first */
    async summary(organizerId) {
        const user = await organizerOr404(organizerId);
        const events = await Event_1.Event.find({ organizerId: user._id }).select('status schedule').lean();
        const eventIds = events.map((e) => e._id);
        const now = Date.now();
        const [invitees, checkIns, invoices, staff, templates, bills] = await Promise.all([
            Invitee_1.Invitee.countDocuments({ eventId: { $in: eventIds } }).setOptions({ includeArchived: true }),
            CheckIn_1.CheckIn.countDocuments({ eventId: { $in: eventIds } }),
            Invoice_1.Invoice.countDocuments({ $or: [{ userId: user._id }, { eventId: { $in: eventIds } }] }),
            staffToErase(user._id, eventIds),
            Template_1.Template.countDocuments({ ownerId: user._id, isActive: { $ne: false } }),
            billing_service_1.billingService.listEventBills(String(user._id))
        ]);
        return {
            name: user.profile?.organizationName || user.fullName,
            email: user.email,
            events: events.length,
            // events that have not ended yet: their guests' passes stop working the moment they are erased
            openEvents: events.filter((e) => e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && e.schedule?.end && new Date(e.schedule.end).getTime() > now).length,
            invitees,
            checkIns,
            invoices,
            systemUsers: staff.length,
            templates,
            amountDue: bills.totalDue,
            currency: bills.currency
        };
    },
    async erase(adminId, organizerId) {
        const user = await organizerOr404(organizerId);
        const counts = await this.summary(organizerId);
        // switched off and signed out first, so nothing new is made while the rest is removed. Not a transaction (it can be far larger than
        // one should be): the account goes last, so an interrupted erasure is finished by pressing Delete again.
        await User_1.User.updateOne({ _id: user._id }, { $set: { isActive: false } });
        await RefreshToken_1.RefreshToken.deleteMany({ userId: user._id });
        const events = await Event_1.Event.find({ organizerId: user._id }).select('media').lean();
        const eventIds = events.map((e) => e._id);
        const staff = await staffToErase(user._id, eventIds);
        for (const event of events) {
            await (0, event_service_1.purgeOperationalData)(String(event._id));
            const logoKey = event.media?.logoKey;
            if (typeof logoKey === 'string' && /^media:[0-9a-fA-F]{24}$/.test(logoKey))
                await (0, mediaStorage_1.deleteMedia)({ _id: logoKey.slice(6) });
        }
        const theirs = { $or: [{ userId: user._id }, { eventId: { $in: eventIds } }] };
        await Promise.all([
            Invoice_1.Invoice.deleteMany(theirs), Payment_1.Payment.deleteMany(theirs), Order_1.Order.deleteMany(theirs), CardDownloadPlan_1.CardDownloadPlan.deleteMany(theirs),
            TicketTier_1.TicketTier.deleteMany({ eventId: { $in: eventIds } })
        ]);
        await Event_1.Event.deleteMany({ _id: { $in: eventIds } });
        await Template_1.Template.deleteMany({ ownerId: user._id });
        await TemplateGenerationJob_1.TemplateGenerationJob.deleteMany({ ownerId: user._id });
        await Category_1.Category.deleteMany({ ownerId: user._id });
        await Category_1.Category.updateMany({ 'subcategories.ownerId': user._id }, { $pull: { subcategories: { ownerId: user._id } } });
        const people = [user._id, ...staff];
        await Promise.all([
            SystemUserAssignment_1.SystemUserAssignment.deleteMany({ userId: { $in: staff } }),
            Notification_1.Notification.deleteMany({ userId: { $in: people } }),
            RefreshToken_1.RefreshToken.deleteMany({ userId: { $in: people } }),
            IdempotencyKey_1.IdempotencyKey.deleteMany({ userId: { $in: people } }),
            VerificationCode_1.VerificationCode.deleteMany({ key: { $in: people.flatMap((id) => [`signup-phone:${id}`, `profile-phone:${id}`, `change-email:${id}`, `verify-email:${id}`]) } })
        ]);
        // codes kept by email address go only when no other account uses the address
        if (!(await User_1.User.exists({ _id: { $nin: people }, email: user.email }))) {
            await Promise.all([EmailVerification_1.EmailVerification.deleteMany({ email: user.email }), PasswordResetOtp_1.PasswordResetOtp.deleteMany({ email: user.email })]);
        }
        await (0, mediaStorage_1.deleteMedia)({ ownerId: { $in: people } });
        await User_1.User.deleteMany({ _id: { $in: staff } });
        await User_1.User.deleteOne({ _id: user._id });
        await auditLog_service_1.auditLogService.record({
            actorId: adminId, actorRole: User_1.Role.ADMIN, entityType: 'User', entityId: String(user._id), action: 'ORGANIZER_ERASED', description: 'An organizer account and its data were permanently deleted',
            metadata: { events: counts.events, invitees: counts.invitees, checkIns: counts.checkIns, invoices: counts.invoices, systemUsers: counts.systemUsers, templates: counts.templates }
        });
        return { deleted: true, ...counts };
    }
};
