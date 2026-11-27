import mongoose from 'mongoose';
import { User, Role } from '../models/User';
import { Event } from '../models/Event';
import { Invitee } from '../models/Invitee';
import { CheckIn } from '../models/CheckIn';
import { Invoice } from '../models/Invoice';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { TicketTier } from '../models/TicketTier';
import { CardDownloadPlan } from '../models/CardDownloadPlan';
import { Template } from '../models/Template';
import { TemplateGenerationJob } from '../models/TemplateGenerationJob';
import { Category } from '../models/Category';
import { Media } from '../models/Media';
import { Notification } from '../models/Notification';
import { RefreshToken } from '../models/RefreshToken';
import { VerificationCode } from '../models/VerificationCode';
import { EmailVerification } from '../models/EmailVerification';
import { PasswordResetOtp } from '../models/PasswordResetOtp';
import { IdempotencyKey } from '../models/IdempotencyKey';
import { SystemUserAssignment } from '../models/SystemUserAssignment';
import { deleteMedia } from './mediaStorage';
import { billingService } from './billing.service';
import { auditLogService } from './auditLog.service';
import { purgeOperationalData } from './event.service';

// "Delete organizer": the account and everything that belongs to it is erased and cannot be brought back. (Deactivating, which only
// stops the account signing in, is the reversible choice.) The audit trail is kept: it records that the erasure happened.

const notFound = () => Object.assign(new Error('Organizer not found'), { statusCode: 404 });

async function organizerOr404(organizerId: string): Promise<any> {
  if (!mongoose.Types.ObjectId.isValid(organizerId)) throw notFound();
  const user = await User.findOne({ _id: organizerId, role: Role.ORGANIZER });
  if (!user) throw notFound();
  return user;
}

/** The organizer's own staff who work nobody else's events: they go with the organizer. Anyone also on another event is kept. */
async function staffToErase(organizerId: unknown, eventIds: unknown[]): Promise<mongoose.Types.ObjectId[]> {
  const mine = (await User.find({ role: Role.SYSTEM_USER, createdBy: organizerId as any }).distinct('_id')) as mongoose.Types.ObjectId[];
  if (!mine.length) return [];
  const elsewhere = new Set((await SystemUserAssignment.find({ userId: { $in: mine }, eventId: { $nin: eventIds as any[] } }).distinct('userId')).map(String));
  return mine.filter((id) => !elsewhere.has(String(id)));
}

export const organizerEraseService = {
  /** What deleting would erase, for the warning shown first */
  async summary(organizerId: string) {
    const user = await organizerOr404(organizerId);
    const events: any[] = await Event.find({ organizerId: user._id }).select('status schedule').lean();
    const eventIds = events.map((e) => e._id);
    const now = Date.now();
    const [invitees, checkIns, invoices, staff, templates, bills] = await Promise.all([
      Invitee.countDocuments({ eventId: { $in: eventIds } }).setOptions({ includeArchived: true } as any),
      CheckIn.countDocuments({ eventId: { $in: eventIds } }),
      Invoice.countDocuments({ $or: [{ userId: user._id }, { eventId: { $in: eventIds } }] }),
      staffToErase(user._id, eventIds),
      Template.countDocuments({ ownerId: user._id, isActive: { $ne: false } }),
      billingService.listEventBills(String(user._id))
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

  async erase(adminId: string, organizerId: string) {
    const user = await organizerOr404(organizerId);
    const counts = await this.summary(organizerId);
    // switched off and signed out first, so nothing new is made while the rest is removed. Not a transaction (it can be far larger than
    // one should be): the account goes last, so an interrupted erasure is finished by pressing Delete again.
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    await RefreshToken.deleteMany({ userId: user._id });

    const events: any[] = await Event.find({ organizerId: user._id }).select('media').lean();
    const eventIds = events.map((e) => e._id);
    const staff = await staffToErase(user._id, eventIds);
    for (const event of events) {
      await purgeOperationalData(String(event._id));
      const logoKey = event.media?.logoKey;
      if (typeof logoKey === 'string' && /^media:[0-9a-fA-F]{24}$/.test(logoKey)) await deleteMedia({ _id: logoKey.slice(6) });
    }
    const theirs = { $or: [{ userId: user._id }, { eventId: { $in: eventIds } }] };
    await Promise.all([
      Invoice.deleteMany(theirs), Payment.deleteMany(theirs), Order.deleteMany(theirs), CardDownloadPlan.deleteMany(theirs),
      TicketTier.deleteMany({ eventId: { $in: eventIds } })
    ]);
    await Event.deleteMany({ _id: { $in: eventIds } });

    await Template.deleteMany({ ownerId: user._id });
    await TemplateGenerationJob.deleteMany({ ownerId: user._id });
    await Category.deleteMany({ ownerId: user._id });
    await Category.updateMany({ 'subcategories.ownerId': user._id }, { $pull: { subcategories: { ownerId: user._id } } });

    const people = [user._id as mongoose.Types.ObjectId, ...staff];
    await Promise.all([
      SystemUserAssignment.deleteMany({ userId: { $in: staff } }),
      Notification.deleteMany({ userId: { $in: people } }),
      RefreshToken.deleteMany({ userId: { $in: people } }),
      IdempotencyKey.deleteMany({ userId: { $in: people } }),
      VerificationCode.deleteMany({ key: { $in: people.flatMap((id) => [`signup-phone:${id}`, `profile-phone:${id}`, `change-email:${id}`, `verify-email:${id}`]) } })
    ]);
    // codes kept by email address go only when no other account uses the address
    if (!(await User.exists({ _id: { $nin: people }, email: user.email }))) {
      await Promise.all([EmailVerification.deleteMany({ email: user.email }), PasswordResetOtp.deleteMany({ email: user.email })]);
    }
    await deleteMedia({ ownerId: { $in: people } });
    await User.deleteMany({ _id: { $in: staff } });
    await User.deleteOne({ _id: user._id });

    await auditLogService.record({
      actorId: adminId, actorRole: Role.ADMIN, entityType: 'User', entityId: String(user._id), action: 'ORGANIZER_ERASED', description: 'An organizer account and its data were permanently deleted',
      metadata: { events: counts.events, invitees: counts.invitees, checkIns: counts.checkIns, invoices: counts.invoices, systemUsers: counts.systemUsers, templates: counts.templates }
    } as any);
    return { deleted: true, ...counts };
  }
};
