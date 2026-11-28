import type { CardDesign } from '../../models/Template';

/**
 * The cards designed for one event type each (Figma "Event Management Invitation Card": Business & Corporate, Festivals & Culture,
 * Personal & Family, Education & Campus, Sports & Fitness).
 * Every one is a fixed background with the same details as the master card laid out as a column, so only the styling and the order
 * differ: they are described here and drawn by themedCard.ts. All sizes are Figma pixels on the 393 x 682 card.
 */
export const THEMED_DESIGNS = [
  'BUSINESS_CONFERENCE', 'PRODUCT_LAUNCH', 'NETWORKING_EVENT', 'CORPORATE_MEET',
  'FESTIVAL_CELEBRATION', 'PUJA_GATHERING', 'CULTURAL_PROGRAM', 'COMMUNITY_FAIR',
  'BIRTHDAY_GOLD', 'BIRTHDAY_LILAC', 'BIRTHDAY_BLUSH', 'BIRTHDAY_RAINBOW',
  'BABY_SHOWER', 'ANNAPRASAN', 'GRIHA_PRAVESH', 'ANNIVERSARY', 'ENGAGEMENT', 'HALDI', 'MEHENDI', 'SANGEET', 'WEDDING_RECEPTION',
  'CONVOCATION', 'FRESHERS_WELCOME', 'FAREWELL', 'COLLEGE_FEST',
  'CRICKET_TOURNAMENT', 'FOOTBALL_TOURNAMENT', 'MARATHON', 'FITNESS_EVENT'
] as const;
export type ThemedDesign = (typeof THEMED_DESIGNS)[number];

export const isThemedDesign = (design: unknown): design is ThemedDesign => (THEMED_DESIGNS as readonly unknown[]).includes(design);
/** The designs offered to everyone: the master card and the themed cards */
export const SHARED_DESIGNS: CardDesign[] = ['MASTER', ...THEMED_DESIGNS];
export const isSharedDesign = (design: unknown): boolean => (SHARED_DESIGNS as unknown[]).includes(design);

export interface TextStyle {
  family: string;
  weight: number;
  size: number;
  /** the smallest size long wording is shrunk to */
  min: number;
  lines: number;
  color: string;
  /** line height as a multiple of the size */
  lh: number;
  upper?: boolean;
  width?: number;
  tracking?: number;
  /** a border drawn around the letters, so they read against a busy picture */
  outline?: { color: string; width: number };
  /** wrapped lines are made about equal in length, so a wide line allowance does not leave one word by itself */
  balance?: boolean;
}

/** `details` is the date and the location with the line between them */
/** `eyebrow` is a fixed line of the design's own; `datecard` is the date set large (month, weekday | day | time) for a one-day event */
/** `divider2` is the design's ornament line drawn a second time */
export type ThemeBlock = 'logo' | 'eyebrow' | 'title' | 'info' | 'qr' | 'details' | 'when' | 'where' | 'datecard' | 'divider' | 'divider2' | 'pin';

export interface CardTheme {
  /** file name (without extension) of the background in assets/cardTemplates/themes; the sample logo is `<key>.logo.png` */
  key: string;
  name: string;
  category: string;
  subcategory: string;
  /** colours for the page a guest lands on, taken from the artwork */
  palette: { background: string; primary: string; accent: string; ink: string; heading: 'serif' | 'sans' };
  /** the designers' own wording, for the template's preview */
  sample: { title: string; primary: string; secondary: string; dateTime: string; location: string };
  sampleDate?: { month: string; weekday: string; day: string; time: string };
  order: ThemeBlock[];
  /** space above a block, when something comes before it */
  gaps: Partial<Record<ThemeBlock, number>>;
  /** where the column sits in the design; with fewer details it stays centred in this space */
  region: [number, number];
  regionNoQr?: [number, number];
  /** a narrower date and location when there is no QR code to push them below the artwork at the sides */
  detailsWidthNoQr?: number;
  /** the column never leaves this space */
  safe: [number, number];
  /**
   * `circle`: a white ring the logo sits inside. `frame`: a picture frame of the design (birthday photos): the event's picture fills
   * the opening, `inner` across (a circle unless `radius` is given; an oval when `innerHeight` differs), over the frame's artwork when it has one.
   */
  logo: { size: number; circle?: { border: string }; frame?: { inner: number; innerHeight?: number; radius?: number; art?: string }; noSample?: boolean };
  eyebrow?: { text: string; style: TextStyle };
  datecard?: { month: TextStyle; small: TextStyle; day: TextStyle; rule: string; gap: number };
  title: TextStyle;
  primary: TextStyle;
  secondary: TextStyle;
  infoGap: number;
  /** an empty `labelText` draws the QR box without a caption, as the design has it */
  /** `art`: an ornamental border picture used instead of the drawn one */
  qr: { size: number; inset: number; border: string; borderWidth: number; radius: number; label: TextStyle; labelText: string; labelAbove?: boolean; labelGap: number; art?: string };
  /** a rounded box the design draws around the date and location (`details`); `colorEnd` shades its border towards the foot */
  box?: { color: string; colorEnd?: string; borderWidth?: number; width: number; radius: number; padY: number };
  when: TextStyle;
  /** a one-day event's `when` on two lines, as the design has it: the time in the `when` style, then the date in this one */
  whenBelow?: TextStyle;
  /** the short line between those two: `offset` below the first, with `gap` between the lines */
  whenBelowRule?: { color: string; width: number; offset: number; gap: number };
  /** the style of a `when` that runs into another day, where the design's large one would break a date apart */
  whenRange?: TextStyle;
  /** blocks that stay on a part of the artwork (a ribbon, the foot of the card) instead of moving with the column */
  anchor?: Partial<Record<ThemeBlock, { top: number } | { middle: number }>>;
  where: TextStyle;
  rule?: { color: string; opacity: number; width: number; gapBefore: number; gapAfter: number };
  /** space between date and location when the design draws no line between them */
  detailsGap?: number;
  /** the design's ornament line: a picture (`file`) or a plain line in `color` */
  divider?: { file?: string; color?: string; width: number; height: number };
  pin?: { file: string; size: number; height?: number };
}

const text = (family: string, weight: number, size: number, color: string, linePx: number, more: Partial<TextStyle> = {}): TextStyle =>
  ({ family, weight, size, color, lh: linePx / size, min: Math.max(9, Math.round(size * 0.65)), lines: 1, ...more });
const qrBox = (border: string, label: TextStyle, more: Partial<CardTheme['qr']> = {}): CardTheme['qr'] =>
  ({ size: 160, inset: 8, border, borderWidth: 1.746, radius: 0, label, labelText: 'Scan the QR code', labelGap: 8, ...more });

const BUSINESS = 'Business & Corporate';
const FESTIVALS = 'Festivals & Culture';
const EDUCATION = 'Education & Campus';
const SPORTS = 'Sports & Fitness';
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
const FAMILY_SAMPLE = {
  primary: 'Primary Information',
  secondary: 'Secondary Information',
  dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM',
  location: '24, Shanti Pally, Near Ruby Crossing, Kolkata - 700107.'
};
const FESTIVAL_SAMPLE = {
  primary: 'Primary Information',
  secondary: 'Secondary Information',
  dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM'
};

export const THEMES: Record<ThemedDesign, CardTheme> = {
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
  },
  BABY_SHOWER: {
    key: 'baby-shower', name: 'Baby Shower Blue Ribbon', category: PERSONAL, subcategory: 'Baby Shower',
    palette: { background: '#FAF7F2', primary: '#07344E', accent: '#E78221', ink: '#00283F', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Your Sample Event Title Goes here', dateTime: '22 January, Friday | at 12:00pm' },
    order: ['logo', 'title', 'info', 'qr', 'when', 'where'], gaps: { title: 5, info: 26, qr: 33, when: 32, where: 9 }, region: [18, 644], safe: [14, 668],
    logo: { size: 120, frame: { inner: 104, art: 'baby-shower.logo' } },
    title: text('Birthstone', 400, 48, '#07344E', 50, { lines: 3, width: 330 }),
    primary: text('Inter', 700, 24, '#004387', 29),
    secondary: text('Inter', 700, 16, '#E78221', 19),
    infoGap: 8,
    qr: qrBox('#78A5BF', text('Alice', 400, 15, '#165A82', 17, { upper: true }), { size: 150, borderWidth: 2, radius: 8, labelGap: 11 }),
    when: text('Alice', 400, 18, '#00283F', 21, { lines: 2, width: 314 }),
    where: text('Alice', 400, 18, '#00283F', 23, { lines: 3, width: 314 })
  },
  ANNAPRASAN: {
    key: 'annaprasan', name: 'Annaprasan Lotus', category: PERSONAL, subcategory: 'Annaprasan',
    palette: { background: '#F2D6DA', primary: '#E42558', accent: '#F26B8F', ink: '#403D15', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here', dateTime: '1 January, Friday | at 3:00pm' },
    order: ['logo', 'title', 'info', 'qr', 'when', 'where'], gaps: { title: 14, info: 29, qr: 23, when: 25, where: 9 }, region: [34, 643], safe: [26, 658],
    logo: { size: 144, frame: { inner: 124, art: 'annaprasan.logo' } },
    title: text('Bigshot One', 400, 49, '#E42558', 51, { lines: 3, width: 340 }),
    primary: text('Alice', 400, 24, '#403D15', 26, { width: 300 }),
    secondary: text('Alice', 400, 18, '#403D15', 23, { width: 300 }),
    infoGap: 0,
    qr: qrBox('#F26B8F', text('Alice', 400, 15, '#403D15', 17, { upper: true }), { size: 120, borderWidth: 2, radius: 5, labelGap: 10 }),
    when: text('Alice', 400, 18, '#403D15', 21, { lines: 2, width: 300 }),
    where: text('Alice', 400, 18, '#403D15', 23, { lines: 3, width: 314 })
  },
  GRIHA_PRAVESH: {
    key: 'griha-pravesh', name: 'Griha Pravesh Marigold', category: PERSONAL, subcategory: 'Griha Pravesh',
    palette: { background: '#F6F3EC', primary: '#BA3127', accent: '#ECB45B', ink: '#BA3127', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here', dateTime: '1 January, Friday | at 3:00pm' },
    order: ['logo', 'title', 'info', 'qr', 'when', 'where'], gaps: { title: 27, info: 26, qr: 30, when: 17, where: 7 }, region: [37, 649], safe: [28, 666],
    logo: { size: 140, frame: { inner: 128, art: 'griha-pravesh.logo' } },
    title: text('Bigshot One', 400, 49, '#BA3127', 51, { lines: 3, width: 340 }),
    primary: text('Alegreya SC', 700, 20, '#BA3127', 27, { width: 250 }),
    secondary: text('Alegreya SC', 700, 15, '#BA3127', 20, { width: 250 }),
    infoGap: 2,
    qr: qrBox('#ECB45B', text('Alegreya SC', 400, 15, '#BA3127', 20, { upper: true }), { size: 120, inset: 5, borderWidth: 2, radius: 5, labelGap: 9 }),
    when: text('Alegreya SC', 700, 18, '#BA3127', 24, { lines: 2, width: 320 }),
    where: text('Alegreya SC', 400, 18, '#BA3127', 24, { lines: 3, width: 338 })
  },
  ANNIVERSARY: {
    key: 'anniversary', name: 'Anniversary Sage Florals', category: PERSONAL, subcategory: 'Anniversary',
    palette: { background: '#E2E6D8', primary: '#45573E', accent: '#8E5800', ink: '#373C41', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Anniversary Event title goes here', location: 'Grand Ballroom, 25 Park Street, Kolkata, WB, India' },
    order: ['logo', 'title', 'info', 'details', 'qr'], gaps: { title: 10, info: 17, details: 26, qr: 16 }, region: [27, 653], safe: [18, 668],
    logo: { size: 133, frame: { inner: 117, art: 'anniversary.frame' } },
    title: text('Abhaya Libre ExtraBold', 800, 34, '#45573E', 40, { lines: 3, width: 320 }),
    primary: text('Alan Sans', 400, 24, '#8E5800', 29, { width: 320 }),
    secondary: text('Alan Sans', 400, 18, '#4D644F', 22, { width: 320 }),
    infoGap: 2,
    qr: qrBox('#45573E', text('Montserrat', 400, 12, '#45573E', 14), { size: 137, borderWidth: 1, radius: 5, labelGap: 8 }),
    when: text('Inter', 700, 17, '#373C41', 21, { lines: 2, width: 327 }),
    where: text('Inter', 400, 18, '#373C41', 22, { lines: 3, width: 320 }),
    rule: { color: '#004387', opacity: 0.5, width: 327, gapBefore: 10, gapAfter: 10 },
    box: { color: '#6E7136', width: 345, radius: 10, padY: 12 }
  },
  ENGAGEMENT: {
    key: 'engagement', name: 'Engagement Pink Blossoms', category: PERSONAL, subcategory: 'Engagement',
    palette: { background: '#F8DDE1', primary: '#64413E', accent: '#DE354C', ink: '#64413E', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Your sample Event title goes here' },
    order: ['logo', 'title', 'when', 'info', 'qr', 'where'], gaps: { title: 15, when: 16, info: 14, qr: 24, where: 20 }, region: [40, 631], safe: [32, 642],
    logo: { size: 118, frame: { inner: 113, art: 'engagement.logo' } },
    title: text('Berkshire Swash', 400, 32, '#64413E', 40, { lines: 3, width: 328, tracking: -0.64 }),
    primary: text('Berkshire Swash', 400, 24, '#DE354C', 39, { width: 328, tracking: -0.48 }),
    secondary: text('Berkshire Swash', 400, 18, '#64413E', 29, { width: 328, tracking: -0.36 }),
    infoGap: 0,
    qr: qrBox('#64413E', text('Aleo', 400, 15, '#64413E', 18), { size: 139, borderWidth: 2, radius: 12, labelGap: 13 }),
    when: text('Aleo', 500, 14, '#64413E', 23, { lines: 2, width: 345 }),
    where: text('Aleo', 500, 16, '#64413E', 23, { lines: 3, width: 300 })
  },
  HALDI: {
    key: 'haldi', name: 'Haldi Sunflowers', category: PERSONAL, subcategory: 'Haldi',
    palette: { background: '#8F2A2B', primary: '#8F2A2B', accent: '#F6AD71', ink: '#3A1010', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here for you!' },
    order: ['logo', 'title', 'divider', 'info', 'qr', 'when', 'divider2', 'where'], gaps: { title: 17, divider: 21, info: 8, qr: 25, when: 22, divider2: 8, where: 6 }, region: [46, 625], safe: [40, 642],
    logo: { size: 120, frame: { inner: 120, art: 'haldi.logo' } },
    title: text('Berkshire Swash', 400, 32, '#F6AD71', 37, { lines: 3, width: 325, tracking: -0.64 }),
    primary: text('Alice', 400, 23, '#FFFFFF', 34, { upper: true, width: 310 }),
    secondary: text('Alice', 400, 18, '#FFA41B', 27, { upper: true, width: 310 }),
    infoGap: 0,
    // the design has no caption under its code
    qr: qrBox('#F6AD71', text('Alice', 400, 12, '#FFFFFF', 16), { size: 120, borderWidth: 2, radius: 5, labelText: '', labelGap: 0 }),
    when: text('Alice', 400, 19, '#FFFFFF', 22, { upper: true, lines: 2, width: 255 }),
    where: text('Alice', 400, 17, '#FFFFFF', 19, { lines: 3, width: 311 }),
    divider: { file: 'haldi-divider', width: 87, height: 7 }
  },
  MEHENDI: {
    key: 'mehendi', name: 'Mehendi Green Arch', category: PERSONAL, subcategory: 'Mehendi',
    palette: { background: '#F5FFE3', primary: '#494D09', accent: '#888C49', ink: '#1D1F03', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here' },
    // the last detail sits in the darker band at the foot of the card, under the code that straddles its edge
    order: ['logo', 'title', 'divider', 'when', 'info', 'qr', 'where'], gaps: { title: 20, divider: 24, when: 15, info: 24, qr: 22, where: 28 }, region: [22, 653], safe: [18, 670],
    logo: { size: 130, frame: { inner: 126, art: 'mehendi.logo' } },
    title: text('IM Fell Great Primer', 400, 40, '#494D09', 40, { lines: 3, width: 290 }),
    primary: text('IM Fell Great Primer', 400, 30, '#494D09', 34, { width: 320 }),
    secondary: text('IM Fell Great Primer', 400, 24, '#494D09', 34, { width: 320 }),
    infoGap: 0,
    qr: qrBox('#888C49', text('Inter', 400, 12, '#494D09', 16), { size: 120, borderWidth: 2, radius: 14, labelText: '', labelGap: 0 }),
    when: text('Inter', 700, 18, '#202020', 22, { lines: 2, width: 260 }),
    where: text('Inter', 600, 14, '#1D1F03', 20, { lines: 3, width: 270 }),
    divider: { file: 'mehendi-divider', width: 171, height: 11 }
  },
  SANGEET: {
    key: 'sangeet', name: 'Sangeet Lanterns', category: PERSONAL, subcategory: 'Sangeet',
    palette: { background: '#FDF6EC', primary: '#772634', accent: '#D6912A', ink: '#772634', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here' },
    order: ['logo', 'title', 'info', 'qr', 'divider', 'where', 'when'], gaps: { title: 12, info: 32, qr: 27, divider: 20, where: 15, when: 12 }, region: [25, 636], safe: [18, 648],
    logo: { size: 151, frame: { inner: 126, innerHeight: 147, art: 'sangeet.logo' } },
    title: text('Cinzel Decorative', 700, 29, '#D6912A', 39, { upper: true, lines: 3, width: 292 }),
    primary: text('Chonburi', 400, 21, '#A45B00', 24, { upper: true, width: 320, lines: 2 }),
    secondary: text('Chonburi', 400, 15, '#C17800', 24, { upper: true, width: 320 }),
    infoGap: 0,
    qr: qrBox('#D6912A', text('Cinzel', 700, 12, '#D6912A', 16), { size: 122, borderWidth: 2, radius: 5, labelText: '', labelGap: 0 }),
    when: text('Cinzel', 700, 14, '#772634', 19, { lines: 2, width: 287 }),
    where: text('Cinzel', 700, 14, '#D6912A', 19, { lines: 3, width: 287 }),
    divider: { file: 'sangeet-divider', width: 130, height: 14 }
  },
  WEDDING_RECEPTION: {
    key: 'wedding-reception', name: 'Wedding Reception Blush', category: PERSONAL, subcategory: 'Wedding Reception',
    palette: { background: '#FFFBF9', primary: '#202020', accent: '#C98B72', ink: '#202020', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here', location: 'Saltlake, Kolkata' },
    order: ['logo', 'title', 'qr', 'info', 'pin', 'where', 'when'], gaps: { title: 15, qr: 20, info: 4, pin: 12, where: 0, when: 0 }, region: [10, 655], safe: [8, 668],
    logo: { size: 186, frame: { inner: 136, art: 'wedding-reception.frame' } },
    title: text('Ancizar Serif', 400, 40, '#202020', 36, { lines: 3, width: 262 }),
    primary: text('Ancizar Serif', 600, 26, '#202020', 33),
    secondary: text('Ancizar Serif', 400, 22, '#202020', 31),
    infoGap: 0,
    qr: qrBox('#202020', text('Ancizar Serif', 400, 12, '#202020', 30, { upper: true }), { size: 151, inset: 17, borderWidth: 0, labelGap: 3, art: 'wedding-reception-qr' }),
    when: text('Ancizar Serif', 400, 16, '#202020', 28, { lines: 2, width: 355 }),
    where: text('Ancizar Serif', 400, 22, '#202020', 30, { lines: 3, width: 320 }),
    pin: { file: 'wedding-reception-pin', size: 20 }
  },
  CONVOCATION: {
    key: 'convocation', name: 'Convocation Gold Frame', category: EDUCATION, subcategory: 'Convocation',
    palette: { background: '#FFFBF3', primary: '#946700', accent: '#BD8C1C', ink: '#4A3400', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Holy Convocation Of Faith, Unity & Spiritual Renewal', dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM', location: 'Grand Ballroom, 25 Park Street, Kolkata, WB, India' },
    order: ['logo', 'title', 'info', 'qr', 'details'], gaps: { title: 14, info: 20, qr: 37, details: 20 }, region: [32, 651], safe: [24, 658],
    logo: { size: 90 },
    title: text('Inria Serif', 700, 26, '#946700', 31, { lines: 3, width: 295 }),
    primary: text('Inter', 700, 22, '#BD8C1C', 27, { width: 345 }),
    secondary: text('Inter', 500, 14, '#946700', 17, { width: 345 }),
    infoGap: 8,
    qr: qrBox('#A6813A', text('Inria Serif', 400, 14, '#946700', 17, { upper: true }), { labelText: 'Scan QR Code' }),
    when: text('Inria Serif', 700, 18, '#946700', 22, { lines: 2, width: 345 }),
    where: text('Inria Serif', 400, 18, '#946700', 22, { lines: 3, width: 345 }),
    rule: { color: '#946700', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 }
  },
  FRESHERS_WELCOME: {
    key: 'freshers-welcome', name: 'Freshers Welcome Night', category: EDUCATION, subcategory: "Freshers' Welcome",
    palette: { background: '#050200', primary: '#B4531F', accent: '#FF8E4C', ink: '#1A0B02', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here', dateTime: 'Saturday, 22nd March 2028' },
    order: ['logo', 'title', 'info', 'qr', 'when', 'where'], gaps: { title: 12, info: 14, qr: 28, when: 25, where: 14 }, region: [30, 636], safe: [18, 664],
    logo: { size: 81 },
    title: text('Inknut Antiqua', 700, 28, '#FFFFFF', 46, { upper: true, lines: 3, width: 320 }),
    primary: text('Inria Serif', 700, 25, '#FF8E4C', 32, { width: 320 }),
    secondary: text('Inria Serif', 700, 18, '#FFFFFF', 32, { width: 320 }),
    infoGap: 0,
    qr: qrBox('#FFFFFF', text('Inria Serif', 700, 12, '#FFFFFF', 19, { upper: true }), { size: 140, borderWidth: 0, radius: 5, labelGap: 13 }),
    when: text('Inria Serif', 700, 25, '#FFFFFF', 29, { upper: true, lines: 3, width: 240 }),
    whenRange: text('Inria Serif', 700, 20, '#FFFFFF', 27, { upper: true, lines: 2, width: 290 }),
    where: text('Inria Serif', 700, 17, '#FFFFFF', 23, { lines: 3, width: 290 })
  },
  FAREWELL: {
    key: 'farewell', name: 'Farewell Fairy Lights', category: EDUCATION, subcategory: 'Farewell',
    palette: { background: '#0F0F0F', primary: '#8A6F1F', accent: '#E7C85F', ink: '#14110A', heading: 'sans' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample Event title goes here', dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM' },
    order: ['logo', 'title', 'info', 'qr', 'details'], gaps: { title: 17, info: 16, qr: 38, details: 14 }, region: [65, 648], safe: [55, 664],
    logo: { size: 91 },
    title: text('Bebas Neue', 400, 53, '#FFFFFF', 64, { upper: true, lines: 3, width: 320, tracking: -1.06 }),
    primary: text('Poppins', 500, 22, '#ECC889', 31, { width: 320 }),
    secondary: text('Poppins', 500, 14, '#FFFFFF', 20, { width: 320 }),
    infoGap: 0,
    qr: qrBox('#E7C85F', text('Poppins', 400, 12, '#E7C85F', 19, { upper: true }), { size: 120, borderWidth: 2, radius: 5, labelGap: 8 }),
    when: text('Bebas Neue', 400, 17, '#E7C85F', 20, { upper: true, lines: 2, width: 282 }),
    where: text('Poppins', 500, 9, '#FFFFFF', 14, { lines: 3, width: 275 }),
    rule: { color: '#D0B351', opacity: 1, width: 272, gapBefore: 10, gapAfter: 6 },
    box: { color: '#E7C85F', colorEnd: '#B89D42', borderWidth: 2, width: 298, radius: 11, padY: 15 }
  },
  COLLEGE_FEST: {
    key: 'college-fest', name: 'College Fest Stage', category: EDUCATION, subcategory: 'College Fest',
    palette: { background: '#14052E', primary: '#7A0A10', accent: '#FFC880', ink: '#1C0620', heading: 'serif' },
    sample: { ...FAMILY_SAMPLE, title: 'Annual Day Event title here', dateTime: 'Sat 2 September 2028 4:00 PM – 9:00 PM' },
    // the date sits on the red ribbon of the artwork, with the place under it
    order: ['logo', 'title', 'info', 'qr', 'when', 'pin', 'where'], gaps: { title: 14, info: 24, qr: 32 }, region: [44, 481], safe: [28, 486],
    anchor: { when: { middle: 523 }, pin: { top: 576 }, where: { top: 614 } },
    logo: { size: 80 },
    title: text('Kalnia', 400, 30, '#FFC880', 40, { upper: true, lines: 3, width: 320, tracking: -1.5 }),
    primary: text('Kantumruy Pro', 400, 24, '#FFFFFF', 28, { width: 286, tracking: -1.2 }),
    secondary: text('Kantumruy Pro', 400, 18, '#FFC880', 21, { width: 286, tracking: -0.9 }),
    infoGap: 3,
    qr: qrBox('#FFC880', text('Poppins', 400, 12, '#FFFFFF', 19, { upper: true }), { size: 120, borderWidth: 2, radius: 5, labelGap: 11 }),
    when: text('Kantumruy Pro', 400, 18, '#FFFFFF', 22, { upper: true, lines: 2, width: 271, tracking: -0.54 }),
    whenBelow: text('Kantumruy Pro', 400, 18, '#FFC880', 22, { upper: true, width: 271, tracking: -0.54 }),
    where: text('Poppins', 500, 13, '#FFFFFF', 18, { lines: 3, width: 260 }),
    pin: { file: 'college-fest-pin', size: 26, height: 32 }
  },
  CRICKET_TOURNAMENT: {
    key: 'cricket-tournament', name: 'Cricket Stadium Blue', category: SPORTS, subcategory: 'Cricket Tournament',
    palette: { background: '#002245', primary: '#00457F', accent: '#0A6CC4', ink: '#001A36', heading: 'sans' },
    sample: { title: 'Annual Cricket Tournament 2026', primary: 'Tollygune Jagarani Club', secondary: 'Block', dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM', location: 'Gostho Paul Sarani, Maidan, B. B. D. Bagh Kolkata, WB, India' },
    order: ['logo', 'title', 'info', 'qr', 'details'], gaps: { title: 25, info: 31, qr: 17, details: 30 }, region: [32, 651], safe: [22, 656],
    logo: { size: 87 },
    title: text('Tomorrow', 700, 32, '#FFFFFF', 38, { upper: true, lines: 3, width: 345 }),
    primary: text('Inter', 700, 22, '#FFFFFF', 27, { width: 345 }),
    secondary: text('Inter', 700, 22, '#FFFFFF', 27, { width: 345 }),
    infoGap: 6,
    qr: qrBox('#FFFFFF', text('Tomorrow Medium', 500, 14, '#FFFFFF', 17, { upper: true }), { borderWidth: 0, labelText: 'Scan QR Code' }),
    when: text('Tomorrow', 700, 18, '#FFFFFF', 22, { lines: 2, width: 345 }),
    where: text('Tomorrow', 400, 18, '#FFFFFF', 22, { lines: 3, width: 325 }),
    rule: { color: '#FFFFFF', opacity: 0.5, width: 345, gapBefore: 10, gapAfter: 10 }
  },
  FOOTBALL_TOURNAMENT: {
    key: 'football-tournament', name: 'Football Night Match', category: SPORTS, subcategory: 'Football Tournament',
    palette: { background: '#0B0D0A', primary: '#5E6B22', accent: '#B8C769', ink: '#10130A', heading: 'sans' },
    sample: { ...FAMILY_SAMPLE, title: 'Sample title goes here', dateTime: '17 August 2028 8:00 PM', location: 'Grand Tower, 53/8 Demo Address goes here' },
    // the address sits on the ribbon of the artwork, the time and date under it
    order: ['logo', 'title', 'qr', 'info', 'where', 'when'], gaps: { title: 18, qr: 21, info: 44 }, region: [35, 489], safe: [22, 510],
    anchor: { where: { middle: 553 }, when: { top: 596 } },
    logo: { size: 86 },
    title: text('BBH Hegarty', 400, 32, '#B8C769', 38, { upper: true, lines: 3, width: 345, tracking: 1.92, min: 15 }),
    primary: text('Inter', 700, 22, '#FFFFFF', 27, { width: 345 }),
    secondary: text('Inter', 500, 18, '#FFFFFF', 22, { width: 345 }),
    infoGap: 8,
    qr: qrBox('#B8C769', text('BBH Bogle', 400, 12, '#FFFFFF', 14, { upper: true, tracking: 0.72 }), { size: 129, borderWidth: 2, radius: 5 }),
    when: text('BBH Bartle', 400, 12, '#FFFFFF', 14, { upper: true, lines: 3, width: 330, tracking: 0.72 }),
    whenBelow: text('BBH Bartle', 400, 12, '#FFFFFF', 14, { upper: true, width: 330, tracking: 0.72 }),
    whenBelowRule: { color: '#FFFFFF', width: 47.5, offset: 10, gap: 18 },
    where: text('BBH Hegarty', 400, 12, '#FFFFFF', 14, { upper: true, lines: 3, width: 365, tracking: 0.72, balance: true })
  },
  MARATHON: {
    key: 'marathon', name: 'Marathon Night Run', category: SPORTS, subcategory: 'Marathon',
    palette: { background: '#0E0A08', primary: '#7A5A00', accent: '#FFEFA3', ink: '#171006', heading: 'sans' },
    sample: { ...FAMILY_SAMPLE, title: 'Sunday Running Marathon', dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM' },
    order: ['logo', 'title', 'qr', 'info', 'when', 'where'], gaps: { title: 18, qr: 24, info: 24, when: 27, where: 16 }, region: [25, 639], safe: [14, 668],
    logo: { size: 90 },
    title: text('Koulen', 400, 52, '#FFEFA3', 52, { upper: true, lines: 3, width: 345 }),
    primary: text('Inter', 700, 24, '#FFEFA3', 29, { width: 345 }),
    secondary: text('Inter', 500, 18, '#FFFFFF', 22, { width: 345 }),
    infoGap: 8,
    qr: qrBox('#FFEFA3', text('Kode Mono', 500, 12, '#FFFFFF', 19, { upper: true, tracking: -0.36 }), { size: 135, borderWidth: 2, radius: 5, labelGap: 12 }),
    when: text('Iosevka Charon Mono', 700, 18, '#FFFFFF', 23, { lines: 2, width: 250 }),
    where: text('Kode Mono', 500, 16, '#FFFFFF', 20, { lines: 3, width: 345, tracking: -0.48, balance: true })
  },
  FITNESS_EVENT: {
    key: 'fitness-event', name: 'Fitness Event Power', category: SPORTS, subcategory: 'Fitness Event',
    palette: { background: '#731C05', primary: '#831D02', accent: '#C2400F', ink: '#3F0D00', heading: 'sans' },
    sample: { ...FAMILY_SAMPLE, title: 'Fitness Event title goes here', dateTime: 'Thu 31 Dec 2026 2:00 PM – Fri 1 Jan 2027 4:00 PM' },
    order: ['logo', 'title', 'info', 'qr', 'when', 'where'], gaps: { title: 13, info: 27, qr: 41, when: 35, where: 18 }, region: [25, 647], safe: [14, 666],
    logo: { size: 90 },
    title: text('Koulen', 400, 40, '#FFFFFF', 45, { upper: true, lines: 3, width: 345, outline: { color: '#3F0D00', width: 4 } }),
    primary: text('Inter', 700, 24, '#FFFFFF', 29, { width: 345 }),
    secondary: text('Inter', 500, 18, '#FFFFFF', 22, { width: 345 }),
    infoGap: 8,
    qr: qrBox('#831D02', text('Poppins', 700, 12, '#FFFFFF', 18, { upper: true }), { size: 139, borderWidth: 1.7, radius: 4.3, labelGap: 6 }),
    when: text('Inter', 700, 18, '#FFFFFF', 22, { lines: 2, width: 345 }),
    where: text('Poppins', 600, 14, '#FFFFFF', 21, { lines: 3, width: 302 })
  }
};
