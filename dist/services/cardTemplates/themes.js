"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEMES = exports.isSharedDesign = exports.SHARED_DESIGNS = exports.isThemedDesign = exports.THEMED_DESIGNS = void 0;
/**
 * The cards designed for one event type each (Figma "Event Management Invitation Card": Business & Corporate, Festivals & Culture,
 * Personal & Family > Birthday).
 * Every one is a fixed background with the same details as the master card laid out as a column, so only the styling and the order
 * differ: they are described here and drawn by themedCard.ts. All sizes are Figma pixels on the 393 x 682 card.
 */
exports.THEMED_DESIGNS = [
    'BUSINESS_CONFERENCE', 'PRODUCT_LAUNCH', 'NETWORKING_EVENT', 'CORPORATE_MEET',
    'FESTIVAL_CELEBRATION', 'PUJA_GATHERING', 'CULTURAL_PROGRAM', 'COMMUNITY_FAIR',
    'BIRTHDAY_GOLD', 'BIRTHDAY_LILAC', 'BIRTHDAY_BLUSH', 'BIRTHDAY_RAINBOW'
];
const isThemedDesign = (design) => exports.THEMED_DESIGNS.includes(design);
exports.isThemedDesign = isThemedDesign;
/** The designs offered to everyone: the master card and the themed cards */
exports.SHARED_DESIGNS = ['MASTER', ...exports.THEMED_DESIGNS];
const isSharedDesign = (design) => exports.SHARED_DESIGNS.includes(design);
exports.isSharedDesign = isSharedDesign;
const text = (family, weight, size, color, linePx, more = {}) => ({ family, weight, size, color, lh: linePx / size, min: Math.max(9, Math.round(size * 0.65)), lines: 1, ...more });
const qrBox = (border, label, more = {}) => ({ size: 160, inset: 8, border, borderWidth: 1.746, radius: 0, label, labelText: 'Scan the QR code', labelGap: 8, ...more });
const BUSINESS = 'Business & Corporate';
const FESTIVALS = 'Festivals & Culture';
const BUSINESS_SAMPLE = {
    title: 'Annual Business Leadership and Innovation Summit 26',
    primary: 'Primary Additional Info',
    secondary: 'Secondary Additional Info',
    dateTime: '14 May 2026, 11:00 - 16 May 2026, 19:00',
    location: '24, Shanti Pally, Near Ruby Crossing, Kolkata - 700107.'
};
const PERSONAL = 'Personal & Family';
const BIRTHDAY_SAMPLE = {
    primary: 'Primary Information',
    secondary: 'Secondary Information',
    dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM'
};
const FESTIVAL_SAMPLE = {
    primary: 'Primary Information',
    secondary: 'Secondary Information',
    dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM'
};
exports.THEMES = {
    BUSINESS_CONFERENCE: {
        key: 'business-conference', name: 'Business Conference', category: BUSINESS, subcategory: 'Business Conference',
        palette: { background: '#F7F7F8', primary: '#0E318C', accent: '#E2350F', ink: '#0E318C', heading: 'sans' },
        sample: BUSINESS_SAMPLE,
        order: ['logo', 'title', 'qr', 'info', 'details'], gaps: { title: 20, qr: 20, info: 20, details: 20 }, region: [50.5, 631.5], safe: [20, 662],
        logo: { size: 100 },
        title: text('Inter', 700, 21, '#0E318C', 33, { upper: true, lines: 4, width: 340 }),
        primary: text('Inter', 600, 26, '#0E318C', 33),
        secondary: text('Inter', 600, 18, '#E2350F', 22),
        infoGap: 8,
        qr: qrBox('#E2350F', text('Poppins', 500, 15, '#E2350F', 22, { upper: true })),
        when: text('Poppins', 600, 15, '#E2350F', 22, { upper: true, lines: 2 }),
        where: text('Poppins', 500, 15, '#0E318C', 22, { lines: 3, width: 300 }),
        rule: { color: '#0E318C', opacity: 0.48, width: 312, gapBefore: 8, gapAfter: 8 }
    },
    PRODUCT_LAUNCH: {
        key: 'product-launch', name: 'Product Launch', category: BUSINESS, subcategory: 'Product Launch',
        palette: { background: '#F4F6F4', primary: '#4A1E12', accent: '#FF8000', ink: '#202020', heading: 'sans' },
        sample: BUSINESS_SAMPLE,
        order: ['title', 'logo', 'info', 'qr', 'details'], gaps: { logo: 22, info: 22, qr: 22, details: 22 }, region: [43.5, 638.5], safe: [20, 662],
        logo: { size: 100 },
        title: text('Montserrat', 700, 22, '#202020', 27, { upper: true, lines: 4, width: 294 }),
        primary: text('Montserrat', 700, 19, '#FF8000', 23, { upper: true }),
        secondary: text('Poppins', 500, 18, '#4A1E12', 27),
        infoGap: 4,
        qr: qrBox('#EF851A', text('Poppins', 500, 15, '#4A1E12', 22, { upper: true })),
        when: text('Poppins', 600, 15, '#4A1E12', 22, { upper: true, lines: 2 }),
        where: text('Poppins', 500, 15, '#4A1E12', 22, { lines: 3, width: 300 }),
        rule: { color: '#4A1E12', opacity: 0.48, width: 312, gapBefore: 8, gapAfter: 8 }
    },
    NETWORKING_EVENT: {
        key: 'networking-event', name: 'Networking Event', category: BUSINESS, subcategory: 'Networking Event',
        palette: { background: '#EEF3F6', primary: '#0251CA', accent: '#0397E5', ink: '#070707', heading: 'sans' },
        sample: { ...BUSINESS_SAMPLE, title: 'Business Networking Title goes here' },
        order: ['title', 'qr', 'info', 'details', 'logo'], gaps: { qr: 20, info: 20, details: 20, logo: 20 }, region: [64, 618], safe: [20, 640],
        logo: { size: 100 },
        title: text('Montserrat', 700, 22, '#0397E5', 27, { upper: true, lines: 4, width: 294 }),
        primary: text('Montserrat', 700, 19, '#070707', 23, { upper: true, width: 300 }),
        secondary: text('Montserrat', 500, 17, '#0397E5', 21, { upper: true, width: 300 }),
        infoGap: 4,
        qr: qrBox('#0397E5', text('Poppins', 500, 15, '#0251CA', 22, { upper: true })),
        when: text('Poppins', 600, 15, '#0251CA', 22, { upper: true, lines: 2 }),
        where: text('Poppins', 500, 15, '#004387', 22, { lines: 3, width: 300 }),
        rule: { color: '#1F7CB5', opacity: 0.58, width: 312, gapBefore: 8, gapAfter: 8 }
    },
    CORPORATE_MEET: {
        key: 'corporate-meet', name: 'Corporate Meet', category: BUSINESS, subcategory: 'Corporate Meet',
        palette: { background: '#EEEEEE', primary: '#004387', accent: '#EF851A', ink: '#033C74', heading: 'sans' },
        sample: {
            title: 'Annual Business Leadership & Innovation Summit 26', primary: 'Primary Information', secondary: 'Secondary Information',
            dateTime: '31 Dec 2026, 14:00 - 02 Jan 2027, 19:00', location: 'Grand Ballroom, 25 Park Street, Kolkata, WB, India'
        },
        order: ['logo', 'title', 'info', 'qr', 'details'], gaps: { title: 24, info: 16, qr: 16, details: 16 }, region: [38, 645], safe: [20, 662],
        logo: { size: 150 },
        title: text('Inter', 700, 24, '#004387', 29, { lines: 4 }),
        primary: text('Inter', 700, 22, '#EF851A', 27),
        secondary: text('Inter', 500, 18, '#004387', 22),
        infoGap: 8,
        qr: qrBox('#004387', text('Inter', 500, 14, '#004387', 17), { labelText: 'Scan QR Code' }),
        when: text('Inter', 700, 16, '#033C74', 19, { lines: 2 }),
        where: text('Inter', 400, 18, '#033C74', 22, { lines: 3 }),
        rule: { color: '#004387', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 }
    },
    FESTIVAL_CELEBRATION: {
        key: 'festival-celebration', name: 'Festival Celebration', category: FESTIVALS, subcategory: 'Festival Celebration',
        palette: { background: '#0B0436', primary: '#3226E2', accent: '#F8A027', ink: '#15191C', heading: 'serif' },
        sample: { ...FESTIVAL_SAMPLE, title: 'Holi – Celebrate the Colours of Joy and Togetherness', location: 'Grand Ballroom, 25 Park Street, Kolkata' },
        order: ['logo', 'title', 'info', 'divider', 'qr', 'pin', 'details'], gaps: { title: 10, info: 24, divider: 8.5, qr: 12.5, pin: 17, details: 10 }, region: [40, 624], regionNoQr: [60, 400], safe: [20, 664],
        // the design shows an empty circle where the event's logo goes
        logo: { size: 100, circle: { border: '#3226E2' }, noSample: true },
        title: text('Judson', 700, 25, '#FFFFFF', 29, { lines: 4, width: 325 }),
        primary: text('Poppins', 500, 21, '#00D9FF', 22),
        secondary: text('Poppins', 500, 15, '#FFFFFF', 22),
        infoGap: 8,
        qr: qrBox('#3226E2', text('Poppins', 500, 13, '#FFFFFF', 22, { upper: true }), { size: 136, inset: 10, borderWidth: 1, radius: 15, labelGap: 13 }),
        when: text('Inter', 700, 18, '#FFFFFF', 22, { lines: 2 }),
        where: text('Inter', 400, 18, '#FFFFFF', 22, { lines: 3 }),
        rule: { color: '#FFFFFF', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 },
        divider: { file: 'festival-divider', width: 132, height: 11 },
        pin: { file: 'festival-pin', size: 24 }
    },
    PUJA_GATHERING: {
        key: 'puja-gathering', name: 'Puja Gathering', category: FESTIVALS, subcategory: 'Puja Gathering',
        palette: { background: '#F1E2CB', primary: '#64413E', accent: '#B24B39', ink: '#2E1900', heading: 'serif' },
        sample: { ...FESTIVAL_SAMPLE, title: 'Shree Ganesha Pooja Invitation-2026', location: '24, Shanti Pally, Near Ruby Crossing, Kolkata - 700107.' },
        order: ['logo', 'title', 'where', 'when', 'divider', 'info', 'qr'], gaps: { title: 22, where: 32, when: 12, divider: 12, info: 15, qr: 21 }, region: [66, 647], safe: [40, 660],
        logo: { size: 100 },
        title: text('Lobster Two', 400, 31, '#64413E', 39, { lines: 3, width: 250, tracking: -0.62 }),
        primary: text('Lobster Two', 400, 31, '#B24B39', 39, { width: 240, tracking: -0.62 }),
        secondary: text('Lobster Two', 400, 24, '#64413E', 30, { width: 240, tracking: -0.48 }),
        infoGap: 1,
        qr: qrBox('#64413E', text('Alice', 400, 11, '#2E1900', 13, { upper: true }), { size: 114, borderWidth: 2, radius: 12, labelAbove: true, labelGap: 13 }),
        when: text('Alice', 400, 16, '#C80003', 18, { upper: true, lines: 2, width: 235 }),
        where: text('Alice', 400, 16, '#2E1900', 18, { upper: true, lines: 3, width: 235 }),
        divider: { file: 'puja-divider', width: 192, height: 7 }
    },
    CULTURAL_PROGRAM: {
        key: 'cultural-program', name: 'Cultural Program', category: FESTIVALS, subcategory: 'Cultural Program',
        palette: { background: '#F7F7F7', primary: '#382454', accent: '#9149BA', ink: '#382454', heading: 'sans' },
        sample: { ...FESTIVAL_SAMPLE, title: 'Annual Cultural Celebration 2026', location: 'Grand Ballroom, 25 Park Street, Kolkata, WB, India' },
        order: ['logo', 'title', 'info', 'qr', 'details'], gaps: { title: 2, info: 19, qr: 33, details: 36 }, region: [18, 651], safe: [16, 664], detailsWidthNoQr: 270,
        logo: { size: 121 },
        title: text('Montserrat', 700, 30, '#382454', 36, { upper: true, lines: 4 }),
        primary: text('Montserrat', 700, 22, '#9149BA', 27, { width: 290 }),
        secondary: text('Montserrat', 700, 18, '#9149BA', 22, { width: 290 }),
        infoGap: 8,
        qr: qrBox('#382454', text('Montserrat', 500, 14, '#382454', 17), { labelText: 'Scan QR Code' }),
        when: text('Montserrat', 700, 18, '#382454', 22, { lines: 2 }),
        where: text('Montserrat', 400, 18, '#382454', 22, { lines: 3 }),
        rule: { color: '#382454', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 }
    },
    COMMUNITY_FAIR: {
        key: 'community-fair', name: 'Community Fair', category: FESTIVALS, subcategory: 'Community Fair',
        palette: { background: '#FFF8F1', primary: '#BF1B2C', accent: '#F89F27', ink: '#15191C', heading: 'sans' },
        sample: { ...FESTIVAL_SAMPLE, title: 'Annual Community Fair & Cultural Celebration 2026', location: 'Community Grounds, Salt Lake, Kolkata' },
        // the QR box sits over the tents at the foot of the card; without it the details stay above them
        order: ['logo', 'title', 'info', 'details', 'qr'], gaps: { title: 14, info: 17, details: 33, qr: 32 }, region: [32, 657], regionNoQr: [32, 500], safe: [20, 666],
        logo: { size: 100 },
        title: text('Luckiest Guy', 400, 30, '#BF1B2C', 31, { lines: 4 }),
        primary: text('Inter', 700, 22, '#000000', 27),
        secondary: text('Inter', 700, 18, '#000000', 22),
        infoGap: 3,
        qr: qrBox('#000000', text('Inter', 500, 14, '#000000', 17), { labelText: 'Scan QR Code', labelAbove: true, labelGap: 16 }),
        when: text('Inter', 700, 18, '#BF1B2C', 28, { lines: 2 }),
        where: text('Inter', 400, 18, '#000000', 22, { lines: 3 }),
        rule: { color: '#000000', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 }
    },
    BIRTHDAY_GOLD: {
        key: 'birthday-1', name: 'Birthday Gold Balloons', category: PERSONAL, subcategory: 'Birthday',
        palette: { background: '#F6F0E6', primary: '#794807', accent: '#A35A00', ink: '#703E00', heading: 'serif' },
        sample: { ...BIRTHDAY_SAMPLE, title: 'Aanvika’s 2nd Birthday Party', location: 'Grand Ballroom, 25 Park Street, Kolkata, WB, India' },
        order: ['logo', 'title', 'divider', 'info', 'qr', 'details'], gaps: { title: 19, divider: 18, info: 11, qr: 27, details: 28 }, region: [36, 656], safe: [20, 668],
        logo: { size: 126, frame: { inner: 97.5, art: 'birthday-1.frame' } },
        title: text('Alkatra', 500, 40, '#794807', 40, { lines: 3, width: 300 }),
        primary: text('Inter', 700, 22, '#703E00', 27),
        secondary: text('Inter', 400, 18, '#703E00', 22),
        infoGap: 12,
        qr: qrBox('#794807', text('Alexandria', 400, 14, '#794807', 17, { upper: true, tracking: 1.68 }), { size: 112.5, inset: 7, borderWidth: 1.5, radius: 9, labelGap: 12 }),
        when: text('Inter', 700, 18, '#703E00', 22, { lines: 2 }),
        where: text('Inter', 400, 18, '#703E00', 22, { lines: 3 }),
        rule: { color: '#004387', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 },
        divider: { color: '#A35A00', width: 200, height: 1 }
    },
    BIRTHDAY_LILAC: {
        key: 'birthday-2', name: 'Birthday Lilac Balloons', category: PERSONAL, subcategory: 'Birthday',
        palette: { background: '#F7F4FA', primary: '#593186', accent: '#A214A4', ink: '#5F008B', heading: 'serif' },
        sample: { ...BIRTHDAY_SAMPLE, title: 'Srija Bhattacharya Birthday Party', location: 'Grand Ballroom, 25 Park Street' },
        order: ['logo', 'title', 'divider', 'info', 'details', 'qr'], gaps: { title: 21, divider: 23, info: 12, details: 24, qr: 27 }, region: [43, 656], safe: [24, 668],
        logo: { size: 128, frame: { inner: 82.5 } },
        title: text('Abril Fatface', 400, 36, '#593186', 40, { lines: 3 }),
        primary: text('Inter', 700, 22, '#A214A4', 27),
        secondary: text('Inter', 400, 18, '#5F008B', 22),
        infoGap: 12,
        qr: qrBox('#004AAD', text('Inter', 400, 14, '#593186', 16), { size: 120, borderWidth: 2, radius: 13, labelAbove: true, labelGap: 12 }),
        when: text('Inter', 700, 18, '#512DC9', 22, { lines: 2 }),
        where: text('Inter', 400, 18, '#512DC9', 22, { lines: 3 }),
        rule: { color: '#004387', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 },
        divider: { file: 'birthday-dots', width: 200, height: 3 }
    },
    BIRTHDAY_BLUSH: {
        key: 'birthday-3', name: 'Birthday Pink Watercolour', category: PERSONAL, subcategory: 'Birthday',
        palette: { background: '#FBEBEF', primary: '#50251B', accent: '#A40F0F', ink: '#301A15', heading: 'serif' },
        sample: { ...BIRTHDAY_SAMPLE, title: 'Srija Bhattacharya Birthday Party', location: '24, Shanti Pally, Near Ruby Crossing, Kolkata - 700107.' },
        order: ['logo', 'title', 'where', 'when', 'divider', 'info', 'qr'], gaps: { title: 19, where: 22, when: 10, divider: 27, info: 12, qr: 20 }, region: [41, 647], safe: [24, 662],
        logo: { size: 124, frame: { inner: 124, radius: 17 } },
        title: text('Young Serif', 400, 34, '#50251B', 45, { lines: 3, width: 330 }),
        primary: text('Inter', 700, 22, '#A40F0F', 27),
        secondary: text('Inter', 400, 18, '#660220', 22),
        infoGap: 12,
        // the design has no caption under its code
        qr: qrBox('#FFA98F', text('Nunito', 400, 12, '#301A15', 16), { size: 120, borderWidth: 2, radius: 10, labelText: '', labelGap: 0 }),
        when: text('Nunito', 700, 18, '#301A15', 25, { lines: 3, width: 262 }),
        where: text('Nunito', 400, 18, '#301A15', 25, { lines: 3, width: 314 }),
        divider: { file: 'birthday-dots', width: 200, height: 3 }
    },
    BIRTHDAY_RAINBOW: {
        key: 'birthday-4', name: 'Birthday Rainbow Stars', category: PERSONAL, subcategory: 'Birthday',
        palette: { background: '#FFF7FA', primary: '#FF5CA2', accent: '#FF9AC5', ink: '#15191C', heading: 'sans' },
        // the design shows no additional lines: they appear only when the event has them
        sample: { primary: '', secondary: '', title: 'Srija Bhattacharya Birthday Party', dateTime: 'Wed 9 Jun 2027 10:00 PM', location: '123 Anywhere St., Any City' },
        sampleDate: { month: 'June', weekday: 'Wednesday', day: '09', time: 'At 10:00 PM' },
        order: ['logo', 'eyebrow', 'title', 'info', 'datecard', 'where', 'qr'], gaps: { eyebrow: 14, title: 10, info: 12, datecard: 20, where: 6, qr: 31 }, region: [30, 668], safe: [18, 672],
        logo: { size: 186, frame: { inner: 186 } },
        eyebrow: { text: 'Join us in birthday celebration', style: text('Chewy', 400, 11, '#FF5CA2', 13, { upper: true, lines: 2, width: 130 }) },
        title: text('Chewy', 400, 34, '#FF5CA2', 40, { lines: 3, width: 300 }),
        primary: text('Chewy', 400, 18, '#FF5CA2', 22),
        secondary: text('Chewy', 400, 15, '#FF5CA2', 19),
        infoGap: 4,
        qr: qrBox('#FF9AC5', text('Chewy', 400, 12, '#FF5CA2', 14), { size: 150, borderWidth: 2, radius: 6, labelGap: 5 }),
        when: text('Chewy', 400, 18, '#FF5CA2', 24, { lines: 2, width: 300 }),
        where: text('Chewy', 400, 15, '#FF5CA2', 19, { lines: 3, width: 300 }),
        datecard: { month: text('Chewy', 400, 24, '#FF5CA2', 28), small: text('Chewy', 400, 15, '#FF5CA2', 19, { width: 100 }), day: text('Chewy', 400, 28, '#FF5CA2', 37, { width: 44 }), rule: '#FF9AC5', gap: 12 }
    }
};
