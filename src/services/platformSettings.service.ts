import { PLATFORM_CURRENCY } from '../constants/currency';
import { cached } from '../infra/cache';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { PlatformSettings, IEventFeatures, INotificationPreferences } from '../models/PlatformSettings';
import { PriceRateChange } from '../models/PriceRateChange';
import { Event } from '../models/Event';
import { Invitee } from '../models/Invitee';
import { Invitation, InvitationDeliveryStatus } from '../models/Invitation';
import { Order, OrderStatus } from '../models/Order';

const KEY = 'global';

/** What an organizer is charged per invitee until an administrator sets a rate (Settings > Price Rate): invitations are never free by accident.
 *  DEFAULT_RATE_PER_INVITEE changes it (0 = free until a rate is set; the automated tests use that). */
export const DEFAULT_RATE_PER_INVITEE = 3;
const defaultRate = (): number => {
  const v = process.env.DEFAULT_RATE_PER_INVITEE;
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RATE_PER_INVITEE;
};
const platformRate = (settings: any): number => {
  const r = settings?.pricing?.ratePerInvitee;
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : defaultRate();
};

async function load() {
  // Upsert so the defaults exist without a separate seeding step
  return PlatformSettings.findOneAndUpdate({ key: KEY }, { $setOnInsert: { key: KEY } }, { new: true, upsert: true, setDefaultsOnInsert: true });
}

// The platform settings are read on almost every bill, notification and event, and change only when an administrator saves them (any write
// clears this cache: see models/PlatformSettings.ts). Readers use the cached copy (a plain object); anything that decides a write reads fresh.
async function loadCached(): Promise<any> {
  return cached('settings', 'global', 60, async () => JSON.parse(JSON.stringify(await load())));
}

const featureKeys: (keyof IEventFeatures)[] = ['allowEventRSVP', 'acceptInvitedAttendees', 'chooseNotRespondedInvitees', 'chooseRSVPDeclinedInvitees', 'askFoodPreference'];
const notificationKeys: (keyof INotificationPreferences)[] = [
  'newOrganizerRegistration', 'newEventAdded', 'deactivatedOrganizerBySuperAdmin', 'changeInPrice',
  'invitationSendFailed', 'dayBeforeEventAlert', 'reportDownload', 'customTemplateRequest', 'newContactMessage',
  'guestCheckIns', 'invitationsSent', 'eventCancelled'
];
const pick = <K extends string>(src: any, keys: K[]) => Object.fromEntries(keys.map((k) => [k, !!src?.[k]])) as Record<K, boolean>;

export const platformSettingsService = {
  async getEventFeatures(): Promise<IEventFeatures> {
    return pick((await loadCached()).eventFeatures, featureKeys);
  },

  async updateEventFeatures(features: Partial<IEventFeatures>): Promise<IEventFeatures> {
    const set = Object.fromEntries(Object.entries(features).filter(([k]) => featureKeys.includes(k as any)).map(([k, v]) => [`eventFeatures.${k}`, !!v]));
    const doc = await PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return pick(doc!.eventFeatures, featureKeys);
  },

  async getNotificationPreferences(): Promise<INotificationPreferences> {
    return pick((await loadCached()).notificationPreferences, notificationKeys);
  },

  async updateNotificationPreferences(prefs: Partial<INotificationPreferences>): Promise<INotificationPreferences> {
    // the in-app choices that so far followed the email ones are written down first, so changing email leaves them as they were
    const before = await this.getPushPreferences();
    await PlatformSettings.updateOne({ key: KEY }, [{ $set: Object.fromEntries(notificationKeys.map((k) => [`pushPreferences.${k}`, { $ifNull: [`$pushPreferences.${k}`, before[k]] }])) }]);
    const set = Object.fromEntries(Object.entries(prefs).filter(([k]) => notificationKeys.includes(k as any)).map(([k, v]) => [`notificationPreferences.${k}`, !!v]));
    const doc = await PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return pick(doc!.notificationPreferences, notificationKeys);
  },

  async getPushPreferences(): Promise<INotificationPreferences> {
    const settings = await loadCached();
    return Object.fromEntries(notificationKeys.map((k) => [k, !!(settings.pushPreferences?.[k] ?? settings.notificationPreferences?.[k])])) as unknown as INotificationPreferences;
  },

  async updatePushPreferences(prefs: Partial<INotificationPreferences>): Promise<INotificationPreferences> {
    const set = Object.fromEntries(Object.entries(prefs).filter(([k]) => notificationKeys.includes(k as any)).map(([k, v]) => [`pushPreferences.${k}`, !!v]));
    await PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return this.getPushPreferences();
  },

  async getPricing() {
    const settings = await loadCached();
    const history = await PriceRateChange.find().sort({ createdAt: -1 }).limit(100).populate('changedBy', 'fullName email').lean();
    return {
      ratePerInvitee: platformRate(settings),
      gstPercent: settings.pricing?.gstPercent ?? 18,
      currency: PLATFORM_CURRENCY,
      updatedAt: settings.pricing?.updatedAt || null,
      history
    };
  },

  /**
   * Gives the rate to every event nothing has been sent for yet (no invitation delivered, no card made, nothing paid, not on Pay Later),
   * so the price shown for them is the price that will be charged. An event whose invitations went out keeps the rate it was sent at.
   * Organizers with a rate of their own are left to it. `organizerId` limits this to one organizer's events.
   */
  async applyRateToUnsentEvents(ratePerInvitee: number, organizerId?: string): Promise<number> {
    const [sent, printed, paid, ownRate] = await Promise.all([
      Invitation.distinct('eventId', { status: InvitationDeliveryStatus.SENT }),
      Invitee.distinct('eventId', { cardDownloadedAt: { $ne: null } }).setOptions({ includeArchived: true } as any),
      Order.distinct('eventId', { kind: 'EVENT_BILL', status: OrderStatus.PAID }),
      User.distinct('_id', { customRatePerInvitee: { $type: 'number' } })
    ]);
    const res = await Event.updateMany(
      {
        _id: { $nin: [...sent, ...printed, ...paid] },
        'payLater.setAt': { $exists: false },
        $and: [{ organizerId: { $nin: ownRate } }, ...(organizerId ? [{ organizerId: new mongoose.Types.ObjectId(organizerId) }] : [])],
        'pricing.ratePerInvitee': { $ne: ratePerInvitee }
      },
      { $set: { pricing: { ratePerInvitee, currency: PLATFORM_CURRENCY, lockedAt: new Date() } } },
      // (not a change to the event itself: an open edit form must not be told the event was changed under it)
      { timestamps: false }
    );
    return res.modifiedCount || 0;
  },

  // The new rate applies to new events and to existing ones with nothing sent yet; events already sent keep their rate
  async updateRate(actorId: string, ratePerInvitee: number) {
    const settings = await load();
    const previous = settings.pricing?.ratePerInvitee ?? null;
    if (previous !== null && Math.abs(previous - ratePerInvitee) < 0.00001) {
      // saved again unchanged: nothing to record, but events that missed the rate are brought to it
      await this.applyRateToUnsentEvents(ratePerInvitee);
      return this.getPricing();
    }
    const currency = PLATFORM_CURRENCY;
    await PlatformSettings.updateOne(
      { key: KEY },
      { $set: { 'pricing.ratePerInvitee': ratePerInvitee, 'pricing.updatedAt': new Date(), 'pricing.updatedBy': new mongoose.Types.ObjectId(actorId) } }
    );
    await PriceRateChange.create({ previousRate: previous, newRate: ratePerInvitee, currency, changedBy: actorId });
    await this.applyRateToUnsentEvents(ratePerInvitee);
    return this.getPricing();
  },

  /** GST (%) added to every bill; the current value applies to bills made from now on */
  async gstPercent(): Promise<number> {
    const settings = await loadCached();
    const g = Number(settings.pricing?.gstPercent);
    return Number.isFinite(g) && g >= 0 ? g : 18;
  },

  async updateGst(actorId: string, gstPercent: number) {
    await PlatformSettings.updateOne(
      { key: KEY },
      { $set: { 'pricing.gstPercent': gstPercent, 'pricing.updatedAt': new Date(), 'pricing.updatedBy': new mongoose.Types.ObjectId(actorId) } }
    );
    return this.getPricing();
  },

  // Rate snapshot stored on a newly created event
  async currentRateSnapshot(organizerId?: unknown) {
    const settings = await loadCached();
    const custom = organizerId ? await this.customRateOf(organizerId) : null;
    return { ratePerInvitee: custom ?? platformRate(settings), currency: PLATFORM_CURRENCY, lockedAt: new Date() };
  },

  /** The rate an administrator set for one organizer, or null when the platform rate applies to them */
  async customRateOf(organizerId: unknown): Promise<number | null> {
    if (!organizerId || !mongoose.Types.ObjectId.isValid(String(organizerId))) return null;
    const u: any = await User.findById(String(organizerId)).select('customRatePerInvitee').lean();
    const r = u?.customRatePerInvitee;
    return typeof r === 'number' && Number.isFinite(r) && r >= 0 ? r : null;
  },

  /** What an organizer is charged per invitee: their own rate when an administrator set one, otherwise the platform rate (null = none set) */
  async rateForOrganizer(organizerId: unknown) {
    const settings = await loadCached();
    const custom = await this.customRateOf(organizerId);
    return { customRate: custom, defaultRate: platformRate(settings), effectiveRate: custom ?? platformRate(settings), currency: PLATFORM_CURRENCY };
  },

  async setOrganizerRate(actorId: string, organizerId: string, rate: number | null) {
    await User.updateOne({ _id: organizerId, role: 'ORGANIZER' }, { $set: { customRatePerInvitee: rate } });
    // back on the platform rate: their events with nothing sent take it
    if (rate === null) await this.applyRateToUnsentEvents(platformRate(await load()), organizerId);
    return this.rateForOrganizer(organizerId);
  },

  // For events created before rates were locked on events: the rate that was in effect at that time
  async rateInEffectAt(when: Date): Promise<number | null> {
    const change = await PriceRateChange.findOne({ createdAt: { $lte: when } }).sort({ createdAt: -1 }).lean();
    return change ? change.newRate : null;
  },

  // Disabled options are forced off on events so the backend, not only the UI, honours the admin settings
  // On create the full rsvp block is written so schema defaults cannot re-enable a disabled option.
  async applyEventFeatureRules(eventData: any, isCreate = false) {
    const f = await this.getEventFeatures();
    if (isCreate && !eventData.rsvp) eventData.rsvp = {};
    if (eventData.rsvp) {
      if (!f.allowEventRSVP) {
        eventData.rsvp.enabled = false;
        delete eventData.rsvp.acceptanceLastDate;
      }
      if (!f.acceptInvitedAttendees) eventData.rsvp.allowAllInvited = false;
      if (!f.chooseNotRespondedInvitees) eventData.rsvp.allowNotResponded = false;
      if (!f.chooseRSVPDeclinedInvitees) eventData.rsvp.allowDeclined = false;
    }
    if (!f.askFoodPreference && eventData.dietaryPreference) {
      eventData.dietaryPreference.enabled = false;
    }
    return eventData;
  }
};
