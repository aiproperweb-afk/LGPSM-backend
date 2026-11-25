"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cardDownloadService = exports.isCardFormat = exports.CARD_FORMATS = exports.MAX_PER_ZIP = exports.fail = void 0;
exports.loadEvent = loadEvent;
exports.maxPerZip = maxPerZip;
exports.zipSizes = zipSizes;
exports.zipFileNames = zipFileNames;
exports.writePartZip = writePartZip;
exports.tellCardsDownloaded = tellCardsDownloaded;
const alert_service_1 = require("./alert.service");
const mongoose_1 = __importDefault(require("mongoose"));
const archiver_1 = __importDefault(require("archiver"));
const sharp_1 = __importDefault(require("sharp"));
const pdf_lib_1 = require("pdf-lib");
const Event_1 = require("../models/Event");
const Invitee_1 = require("../models/Invitee");
const Session_1 = require("../models/Session");
const CardDownloadPlan_1 = require("../models/CardDownloadPlan");
const User_1 = require("../models/User");
const invitation_util_1 = require("../utils/invitation.util");
const tokenCipher_1 = require("../utils/tokenCipher");
const credentialTokens_1 = require("../utils/credentialTokens");
const invitation_service_1 = require("./invitation.service");
const credential_service_1 = require("./credential.service");
// The page takes the card's own shape and pixel size (never a fixed paper size, which would stretch it): 1 px = 72/256 pt, i.e. 256 dpi,
// so the QR code and text stay sharp for print.
const PT_PER_PX = 72 / 256;
const RENDER_AT_A_TIME = 3;
const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code, message });
exports.fail = fail;
async function loadEvent(actor, eventId) {
    if (!mongoose_1.default.Types.ObjectId.isValid(eventId))
        throw (0, exports.fail)(400, 'Invalid event id');
    const event = actor.role === User_1.Role.ADMIN ? await Event_1.Event.findById(eventId) : await Event_1.Event.findOne({ _id: eventId, organizerId: actor.userId });
    if (!event)
        throw (0, exports.fail)(404, 'Event not found or inaccessible');
    if (event.invitationType !== 'PRINT' && event.invitationType !== 'BOTH') {
        throw (0, exports.fail)(409, 'This event is set to digital invitations only, so there are no printable cards to download.', 'NOT_A_PRINT_EVENT');
    }
    // printing issues a guest's entry pass like sending does, so a cancelled or finished event cannot do it either
    try {
        (0, invitation_service_1.assertEventCanIssue)(event);
    }
    catch (e) {
        throw (0, exports.fail)(409, e?.message === 'EVENT_CANCELLED' ? 'This event is cancelled.' : 'This event is over, so cards can no longer be produced.', 'EVENT_CLOSED');
    }
    return event;
}
/** Most guests one zip holds. The split is the system's: nobody chooses it, so a large selection can never become a flood of tiny zips. */
exports.MAX_PER_ZIP = 100;
/** The limit in force: CARD_ZIP_MAX_GUESTS (1 to 100) lets a slow server use smaller zips, which are quicker to prepare one by one */
function maxPerZip() {
    const n = Math.floor(Number(process.env.CARD_ZIP_MAX_GUESTS));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, exports.MAX_PER_ZIP) : exports.MAX_PER_ZIP;
}
const PLAN_MINUTES = 60;
/**
 * How many guests go in each zip: as few zips as the 100 limit allows, filled evenly (1000 guests: 10 zips of 100; 150: two of 75;
 * 250: three of 84, 83 and 83), never a full zip followed by a small leftover.
 */
function zipSizes(total) {
    if (total <= 0)
        return [];
    const zips = Math.ceil(total / maxPerZip());
    const base = Math.floor(total / zips);
    const extra = total % zips;
    return Array.from({ length: zips }, (_, i) => base + (i < extra ? 1 : 0));
}
/**
 * The zip's name: "Event name_Session name.zip", or just "Event name.zip" when the cards are not for one particular session. A selection
 * that needs several zips numbers them ("Event name_Session name_1.zip", "_2" ...). The names are the person's own words, with only the
 * characters a file name cannot hold taken out.
 */
const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
function zipFileNames(eventTitle, sessionName, zips) {
    const base = [fileSafe(eventTitle) || 'Event', sessionName ? fileSafe(sessionName) : ''].filter(Boolean).join('_');
    return Array.from({ length: zips }, (_, i) => `${base}${zips > 1 ? `_${i + 1}` : ''}.zip`);
}
const asciiName = (n) => n.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'cards.zip';
const safeName = (s) => String(s || 'guest').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'guest';
/**
 * Writes ONE zip of printable PDFs (one per guest, in order) to `out`. A guest with no pass yet gets one (nothing is sent to them).
 * `onGuest` is called after each guest so a caller can show progress.
 */
/** The file kinds a card can be downloaded as. The first is the default (and what every download was before the choice existed). */
exports.CARD_FORMATS = [
    { value: 'PRINT_PDF', label: 'Print PDF (High Resolution)', ext: 'pdf' },
    { value: 'WEB_PDF', label: 'PDF (Smaller file)', ext: 'pdf' },
    { value: 'PNG', label: 'PNG image (High Resolution)', ext: 'png' },
    { value: 'JPG', label: 'JPG image (Smaller file)', ext: 'jpg' },
];
const isCardFormat = (v) => exports.CARD_FORMATS.some((f) => f.value === v);
exports.isCardFormat = isCardFormat;
async function writePartZip(actor, event, guests, firstIndex, out, onGuest, format = 'PRINT_PDF') {
    const ext = exports.CARD_FORMATS.find((f) => f.value === format).ext;
    const zip = (0, archiver_1.default)('zip', { store: true }); // the PDFs are already compressed
    zip.on('warning', (e) => console.warn('Card zip warning:', e.message));
    const written = new Promise((resolve, reject) => { out.on('finish', () => resolve()); out.on('error', reject); });
    zip.pipe(out);
    const skipped = [];
    // the pass printed on a card is the guest's entry credential: a guest who has none yet gets one now (nothing is sent to them).
    const passFor = async (g) => {
        const existing = (0, credentialTokens_1.readAdmissionToken)(g);
        if (existing)
            return existing;
        // a pass exists but its secret cannot be recovered (an old invitation): never replace it, that would break the card they already hold
        if (g.qrTokenHash)
            return null;
        const raw = (0, invitation_util_1.generateSecureToken)();
        const upd = await Invitee_1.Invitee.updateOne({ _id: g._id, qrTokenHash: { $in: [null, undefined, ''] } }, { $set: { qrTokenHash: (0, invitation_util_1.hashToken)(raw), qrTokenCipher: (0, tokenCipher_1.encryptToken)(raw) } });
        if (upd.modifiedCount !== 1)
            return (0, credentialTokens_1.readAdmissionToken)((await Invitee_1.Invitee.findById(g._id).select('+qrTokenCipher')));
        g.qrTokenHash = (0, invitation_util_1.hashToken)(raw);
        g.qrTokenCipher = (0, tokenCipher_1.encryptToken)(raw);
        await credential_service_1.credentialService.recordIssuance({ invitee: g, tokenHash: (0, invitation_util_1.hashToken)(raw), source: 'SEND', actorId: actor.userId, actorRole: actor.role, organizerId: event.organizerId })
            .catch((e) => console.error('Credential history not recorded:', e?.message));
        return raw;
    };
    const makePdf = async (g) => {
        const token = await passFor(g);
        if (!token)
            return null;
        const png = await invitation_service_1.invitationService.renderPassCard(event, g, token);
        // the image formats are the card itself; the PDFs put it on a page of its own shape
        if (format === 'PNG')
            return png;
        if (format === 'JPG')
            return (0, sharp_1.default)(png).flatten({ background: '#ffffff' }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
        const meta = await (0, sharp_1.default)(png).metadata();
        // the smaller PDF holds the card at half the size in each direction (still sharp on screen, a fraction of the file)
        const scale = format === 'WEB_PDF' ? 0.5 : 1;
        const pxW = Math.round((meta.width || 1536) * scale);
        const pxH = Math.round((meta.height || 2048) * scale);
        let flat = (0, sharp_1.default)(png).flatten({ background: '#ffffff' });
        if (scale !== 1)
            flat = flat.resize(pxW, pxH);
        const jpg = await flat.jpeg({ quality: format === 'WEB_PDF' ? 85 : 95, chromaSubsampling: '4:4:4' }).toBuffer();
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.setTitle(`${event.title}: ${g.name}`);
        pdf.setCreator('EventQRapp');
        const img = await pdf.embedJpg(jpg);
        // the page keeps the full card's size whichever resolution the picture has
        const pageW = (pxW / scale) * PT_PER_PX;
        const pageH = (pxH / scale) * PT_PER_PX;
        const page = pdf.addPage([pageW, pageH]);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
        return Buffer.from(await pdf.save());
    };
    // Making the cards locks the event (like sending an invitation): the guests will hold cards made from its details.
    // Marked before the first card is drawn, and without touching updatedAt so an open editor is not told the event changed.
    if (!event.cardsDownloadedAt) {
        await Event_1.Event.updateOne({ _id: event._id, cardsDownloadedAt: { $in: [null, undefined] } }, { $set: { cardsDownloadedAt: new Date() } }, { timestamps: false });
        event.cardsDownloadedAt = new Date();
    }
    try {
        for (let i = 0; i < guests.length; i += RENDER_AT_A_TIME) {
            const slice = guests.slice(i, i + RENDER_AT_A_TIME);
            const pdfs = await Promise.all(slice.map((g) => makePdf(g).catch((e) => { console.error('Card not drawn:', e?.message); return null; })));
            // the guests whose card was made are "used" for billing from now on (a later send is not charged again)
            const made = slice.filter((_, k) => !!pdfs[k]).map((g) => g._id);
            if (made.length)
                await Invitee_1.Invitee.updateMany({ _id: { $in: made } }, { $set: { cardDownloadedAt: new Date() } }, { timestamps: false });
            slice.forEach((g, k) => {
                const pdf = pdfs[k];
                if (!pdf) {
                    skipped.push(g.name);
                    return;
                }
                zip.append(pdf, { name: `${String(firstIndex + i + k + 1).padStart(4, '0')}-${safeName(g.name)}.${ext}` });
            });
            slice.forEach(() => onGuest?.());
        }
        if (skipped.length) {
            zip.append(`These guests have no card in this file:\n${skipped.map((n) => `- ${n}`).join('\n')}\n\nA guest whose earlier invitation cannot be redrawn keeps the card they already have; the others could not be drawn (try again).\n`, { name: '_not-included.txt' });
        }
        await zip.finalize();
        await written; // everything has reached `out` (a file is complete only now)
    }
    catch (err) {
        zip.abort();
        throw err;
    }
}
/** The organizer's notification list records a card download once, however many files it comes in */
async function tellCardsDownloaded(event, count) {
    await alert_service_1.alertService.notifyUser(event.organizerId, { type: 'CARDS', title: 'Invitation cards downloaded', message: `${count} invitation card${count === 1 ? ' was' : 's were'} prepared for download for "${event.title}".`, entityType: 'Event', entityId: event._id });
}
exports.cardDownloadService = {
    /** Keeps the chosen guests under a plan id and says how many zip files they make. Only guests of this event are kept. */
    async plan(actor, eventId, inviteeIds, sessionId) {
        const event = await loadEvent(actor, eventId);
        // the session the list was filtered to (it names the zips); it must be one of this event's
        let session = null;
        if (sessionId) {
            session = mongoose_1.default.Types.ObjectId.isValid(sessionId) ? await Session_1.Session.findOne({ _id: sessionId, eventId }).select('name').lean() : null;
            if (!session)
                throw (0, exports.fail)(400, 'That session is not part of this event.');
        }
        const ids = [...new Set(inviteeIds.filter((i) => mongoose_1.default.Types.ObjectId.isValid(i)))];
        if (ids.length === 0)
            throw (0, exports.fail)(400, 'Select at least one guest to download cards for.', 'NO_GUESTS_SELECTED');
        const found = await Invitee_1.Invitee.find({ eventId, _id: { $in: ids } }).select('_id invitationStatus').sort({ createdAt: 1, _id: 1 }).lean();
        if (found.length === 0)
            throw (0, exports.fail)(400, 'None of the selected guests are on this event.', 'NO_GUESTS_SELECTED');
        // Print and Digital both: a guest's invitation goes out first, then the printed card is made, so the digital pass and the card are the same one
        if (event.invitationType === 'BOTH') {
            const notSent = found.filter((g) => g.invitationStatus !== 'SENT').length;
            if (notSent > 0)
                throw (0, exports.fail)(409, `${notSent} of the selected ${notSent === 1 ? 'guest has' : 'guests have'} not been sent an invitation yet. Send the invitations first, then download their cards.`, 'INVITATIONS_NOT_SENT');
        }
        // Cards are paid for before they are made, just like sending: the same per-guest charge, and a guest already paid for (sent or downloaded) is not charged again
        if (actor.role !== 'ADMIN') {
            const { billingService } = await Promise.resolve().then(() => __importStar(require('./billing.service')));
            await billingService.assertPaidFor(event, found.map((g) => String(g._id))).catch((e) => {
                if (e?.message === 'PAYMENT_REQUIRED')
                    throw (0, exports.fail)(402, 'Please pay the bill for these cards first. Nothing was downloaded.', 'PAYMENT_REQUIRED');
                throw e;
            });
        }
        const plan = await CardDownloadPlan_1.CardDownloadPlan.create({
            eventId, userId: actor.userId, inviteeIds: found.map((g) => g._id), sessionId: session ? session._id : null, expiresAt: new Date(Date.now() + PLAN_MINUTES * 60 * 1000)
        });
        const sizes = zipSizes(found.length);
        const outer = zipFileNames(event.title, session ? session.name : null, 1)[0];
        return { planId: String(plan._id), total: found.length, zips: sizes.length, sizes, fileNames: zipFileNames(event.title, session ? session.name : null, sizes.length), /** the one file the person downloads */ fileName: outer, /** the kinds of file the cards can be downloaded as (the first is the default) */ formats: exports.CARD_FORMATS.map(({ value, label }) => ({ value, label })), /** true when it holds smaller zips (more than 100 guests); false when it holds the PDFs directly */ nested: sizes.length > 1 };
    },
    /**
     * Streams ONE zip: part `part` (1-based) of a plan. Each guest has their own PDF holding their personal card at print quality.
     * Part 3 of 10 is always the same guests, so the parts can be fetched one after another to download every card.
     */
    async streamZip(actor, eventId, opts, res) {
        const event = await loadEvent(actor, eventId);
        const plan = mongoose_1.default.Types.ObjectId.isValid(opts.planId) ? await CardDownloadPlan_1.CardDownloadPlan.findOne({ _id: opts.planId, eventId, userId: actor.userId }).lean() : null;
        if (!plan)
            throw (0, exports.fail)(404, 'This download has expired. Please start it again.', 'PLAN_EXPIRED');
        const sizes = zipSizes(plan.inviteeIds.length);
        const part = Math.floor(opts.part) || 1;
        if (part < 1 || part > sizes.length)
            throw (0, exports.fail)(400, 'That part does not exist.');
        const zips = sizes.length;
        const total = plan.inviteeIds.length;
        const offset = sizes.slice(0, part - 1).reduce((a, b) => a + b, 0);
        const wanted = plan.inviteeIds.slice(offset, offset + sizes[part - 1]);
        const order = new Map(wanted.map((id, i) => [String(id), i]));
        const guests = (await Invitee_1.Invitee.find({ eventId, _id: { $in: wanted } }).select('+qrTokenCipher')).sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
        const firstIndex = offset;
        const sess = plan.sessionId ? await Session_1.Session.findOne({ _id: plan.sessionId, eventId }).select('name').lean() : null;
        const fileName = zipFileNames(event.title, sess ? sess.name : null, zips)[part - 1];
        res.status(200);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${asciiName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader('X-Zip-Part', String(part));
        res.setHeader('X-Zip-Count', String(zips));
        res.setHeader('X-Guests-Total', String(total));
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Zip-Part, X-Zip-Count, X-Guests-Total');
        await writePartZip(actor, event, guests, firstIndex, res, undefined, (0, exports.isCardFormat)(opts.format) ? opts.format : 'PRINT_PDF');
        if (part === 1)
            await tellCardsDownloaded(event, total);
    }
};
