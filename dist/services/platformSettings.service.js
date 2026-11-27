"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformSettingsService = exports.DEFAULT_RATE_PER_INVITEE = void 0;
const currency_1 = require("../constants/currency");
const cache_1 = require("../infra/cache");
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = require("../models/User");
const PlatformSettings_1 = require("../models/PlatformSettings");
const PriceRateChange_1 = require("../models/PriceRateChange");
const Event_1 = require("../models/Event");
const Invitee_1 = require("../models/Invitee");
const Invitation_1 = require("../models/Invitation");
const Order_1 = require("../models/Order");
const KEY = 'global';
/** What an organizer is charged per invitee until an administrator sets a rate (Settings > Price Rate): invitations are never free by accident.
 *  DEFAULT_RATE_PER_INVITEE changes it (0 = free until a rate is set; the automated tests use that). */
exports.DEFAULT_RATE_PER_INVITEE = 3;
const defaultRate = () => {
    const v = process.env.DEFAULT_RATE_PER_INVITEE;
    const n = v === undefined || v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : exports.DEFAULT_RATE_PER_INVITEE;
};
const platformRate = (settings) => {
    const r = settings?.pricing?.ratePerInvitee;
    return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : defaultRate();
};
async function load() {
    // Upsert so the defaults exist without a separate seeding step
    return PlatformSettings_1.PlatformSettings.findOneAndUpdate({ key: KEY }, { $setOnInsert: { key: KEY } }, { new: true, upsert: true, setDefaultsOnInsert: true });
}
// The platform settings are read on almost every bill, notification and event, and change only when an administrator saves them (any write
// clears this cache: see models/PlatformSettings.ts). Readers use the cached copy (a plain object); anything that decides a write reads fresh.
async function loadCached() {
    return (0, cache_1.cached)('settings', 'global', 60, async () => JSON.parse(JSON.stringify(await load())));
}
const featureKeys = ['allowEventRSVP', 'acceptInvitedAttendees', 'chooseNotRespondedInvitees', 'chooseRSVPDeclinedInvitees', 'askFoodPreference'];
const notificationKeys = [
    'newOrganizerRegistration', 'newEventAdded', 'deactivatedOrganizerBySuperAdmin', 'changeInPrice',
    'invitationSendFailed', 'dayBeforeEventAlert', 'reportDownload', 'customTemplateRequest', 'newContactMessage',
    'guestCheckIns', 'invitationsSent', 'eventCancelled'
];
const pick = (src, keys) => Object.fromEntries(keys.map((k) => [k, !!src?.[k]]));
exports.platformSettingsService = {
    async getEventFeatures() {
        return pick((await loadCached()).eventFeatures, featureKeys);
    },
    async updateEventFeatures(features) {
        const set = Object.fromEntries(Object.entries(features).filter(([k]) => featureKeys.includes(k)).map(([k, v]) => [`eventFeatures.${k}`, !!v]));
        const doc = await PlatformSettings_1.PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
        return pick(doc.eventFeatures, featureKeys);
    },
    async getNotificationPreferences() {
        return pick((await loadCached()).notificationPreferences, notificationKeys);
    },
    async updateNotificationPreferences(prefs) {
        // the in-app choices that so far followed the email ones are written down first, so changing email leaves them as they were
        const before = await this.getPushPreferences();
        await PlatformSettings_1.PlatformSettings.updateOne({ key: KEY }, [{ $set: Object.fromEntries(notificationKeys.map((k) => [`pushPreferences.${k}`, { $ifNull: [`$pushPreferences.${k}`, before[k]] }])) }]);
        const set = Object.fromEntries(Object.entries(prefs).filter(([k]) => notificationKeys.includes(k)).map(([k, v]) => [`notificationPreferences.${k}`, !!v]));
        const doc = await PlatformSettings_1.PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
        return pick(doc.notificationPreferences, notificationKeys);
    },
    async getPushPreferences() {
        const settings = await loadCached();
        return Object.fromEntries(notificationKeys.map((k) => [k, !!(settings.pushPreferences?.[k] ?? settings.notificationPreferences?.[k])]));
    },
    async updatePushPreferences(prefs) {
        const set = Object.fromEntries(Object.entries(prefs).filter(([k]) => notificationKeys.includes(k)).map(([k, v]) => [`pushPreferences.${k}`, !!v]));
        await PlatformSettings_1.PlatformSettings.findOneAndUpdate({ key: KEY }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
        return this.getPushPreferences();
    },
    async getPricing() {
        const settings = await loadCached();
        const history = await PriceRateChange_1.PriceRateChange.find().sort({ createdAt: -1 }).limit(100).populate('changedBy', 'fullName email').lean();
        return {
            ratePerInvitee: platformRate(settings),
            gstPercent: settings.pricing?.gstPercent ?? 18,
            currency: currency_1.PLATFORM_CURRENCY,
            updatedAt: settings.pricing?.updatedAt || null,
            history
        };
    },
    /**
     * Gives the rate to every event nothing has been sent for yet (no invitation delivered, no card made, nothing paid, not on Pay Later),
     * so the price shown for them is the price that will be charged. An event whose invitations went out keeps the rate it was sent at.
     * Organizers with a rate of their own are left to it. `organizerId` limits this to one organizer's events.
     */
    async applyRateToUnsentEvents(ratePerInvitee, organizerId) {
        const [sent, printed, paid, ownRate] = await Promise.all([
            Invitation_1.Invitation.distinct('eventId', { status: Invitation_1.InvitationDeliveryStatus.SENT }),
            Invitee_1.Invitee.distinct('eventId', { cardDownloadedAt: { $ne: null } }).setOptions({ includeArchived: true }),
            Order_1.Order.distinct('eventId', { kind: 'EVENT_BILL', status: Order_1.OrderStatus.PAID }),
            User_1.User.distinct('_id', { customRatePerInvitee: { $type: 'number' } })
        ]);
        const res = await Event_1.Event.updateMany({
            _id: { $nin: [...sent, ...printed, ...paid] },
            'payLater.setAt': { $exists: false },
            $and: [{ organizerId: { $nin: ownRate } }, ...(organizerId ? [{ organizerId: new mongoose_1.default.Types.ObjectId(organizerId) }] : [])],
            'pricing.ratePerInvitee': { $ne: ratePerInvitee }
        }, { $set: { pricing: { ratePerInvitee, currency: currency_1.PLATFORM_CURRENCY, lockedAt: new Date() } } }, 
        // (not a change to the event itself: an open edit form must not be told the event was changed under it)
        { timestamps: false });
        return res.modifiedCount || 0;
    },
    // The new rate applies to new events and to existing ones with nothing sent yet; events already sent keep their rate
    async updateRate(actorId, ratePerInvitee) {
        const settings = await load();
        const previous = settings.pricing?.ratePerInvitee ?? null;
        if (previous !== null && Math.abs(previous - ratePerInvitee) < 0.00001) {
            // saved again unchanged: nothing to record, but events that missed the rate are brought to it
            await this.applyRateToUnsentEvents(ratePerInvitee);
            return this.getPricing();
        }
        const currency = currency_1.PLATFORM_CURRENCY;
        await PlatformSettings_1.PlatformSettings.updateOne({ key: KEY }, { $set: { 'pricing.ratePerInvitee': ratePerInvitee, 'pricing.updatedAt': new Date(), 'pricing.updatedBy': new mongoose_1.default.Types.ObjectId(actorId) } });
        await PriceRateChange_1.PriceRateChange.create({ previousRate: previous, newRate: ratePerInvitee, currency, changedBy: actorId });
        await this.applyRateToUnsentEvents(ratePerInvitee);
        return this.getPricing();
    },
    /** GST (%) added to every bill; the current value applies to bills made from now on */
    async gstPercent() {
        const settings = await loadCached();
        const g = Number(settings.pricing?.gstPercent);
        return Number.isFinite(g) && g >= 0 ? g : 18;
    },
    async updateGst(actorId, gstPercent) {
        await PlatformSettings_1.PlatformSettings.updateOne({ key: KEY }, { $set: { 'pricing.gstPercent': gstPercent, 'pricing.updatedAt': new Date(), 'pricing.updatedBy': new mongoose_1.default.Types.ObjectId(actorId) } });
        return this.getPricing();
    },
    // Rate snapshot stored on a newly created event
    async currentRateSnapshot(organizerId) {
        const settings = await loadCached();
        const custom = organizerId ? await this.customRateOf(organizerId) : null;
        return { ratePerInvitee: custom ?? platformRate(settings), currency: currency_1.PLATFORM_CURRENCY, lockedAt: new Date() };
    },
    /** The rate an administrator set for one organizer, or null when the platform rate applies to them */
    async customRateOf(organizerId) {
        if (!organizerId || !mongoose_1.default.Types.ObjectId.isValid(String(organizerId)))
            return null;
        const u = await User_1.User.findById(String(organizerId)).select('customRatePerInvitee').lean();
        const r = u?.customRatePerInvitee;
        return typeof r === 'number' && Number.isFinite(r) && r >= 0 ? r : null;
    },
    /** What an organizer is charged per invitee: their own rate when an administrator set one, otherwise the platform rate (null = none set) */
    async rateForOrganizer(organizerId) {
        const settings = await loadCached();
        const custom = await this.customRateOf(organizerId);
        return { customRate: custom, defaultRate: platformRate(settings), effectiveRate: custom ?? platformRate(settings), currency: currency_1.PLATFORM_CURRENCY };
    },
    async setOrganizerRate(actorId, organizerId, rate) {
        await User_1.User.updateOne({ _id: organizerId, role: 'ORGANIZER' }, { $set: { customRatePerInvitee: rate } });
        // back on the platform rate: their events with nothing sent take it
        if (rate === null)
            await this.applyRateToUnsentEvents(platformRate(await load()), organizerId);
        return this.rateForOrganizer(organizerId);
    },
    // For events created before rates were locked on events: the rate that was in effect at that time
    async rateInEffectAt(when) {
        const change = await PriceRateChange_1.PriceRateChange.findOne({ createdAt: { $lte: when } }).sort({ createdAt: -1 }).lean();
        return change ? change.newRate : null;
    },
    // Disabled options are forced off on events so the backend, not only the UI, honours the admin settings
    // On create the full rsvp block is written so schema defaults cannot re-enable a disabled option.
    async applyEventFeatureRules(eventData, isCreate = false) {
        const f = await this.getEventFeatures();
        if (isCreate && !eventData.rsvp)
            eventData.rsvp = {};
        if (eventData.rsvp) {
            if (!f.allowEventRSVP) {
                eventData.rsvp.enabled = false;
                delete eventData.rsvp.acceptanceLastDate;
            }
            if (!f.acceptInvitedAttendees)
                eventData.rsvp.allowAllInvited = false;
            if (!f.chooseNotRespondedInvitees)
                eventData.rsvp.allowNotResponded = false;
            if (!f.chooseRSVPDeclinedInvitees)
                eventData.rsvp.allowDeclined = false;
        }
        if (!f.askFoodPreference && eventData.dietaryPreference) {
            eventData.dietaryPreference.enabled = false;
        }
        return eventData;
    }
};
