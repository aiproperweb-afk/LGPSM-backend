/** The cards made for one event type each: every detail is drawn from the event, and the card holds together when details are left off. */
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { renderThemedCard } from '../src/services/cardTemplates/themedCard';
import { THEMED_DESIGNS, THEMES } from '../src/services/cardTemplates/themes';
import { publicThemeFor } from '../src/services/cardTemplates/publicTheme';
import { fontFileFor } from '../src/services/cardTemplates/fonts';
import { masterDateParts } from '../src/services/cardTemplates/content';

jest.setTimeout(180_000);

const CODE = 'https://lgpsm.example/invitation/themed-card-test-code';
const read = async (png: Buffer) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
};
const pixels = (png: Buffer) => sharp(png).raw().toBuffer();

describe('themed cards', () => {
  let qr: Buffer;
  beforeAll(async () => { qr = await QRCode.toBuffer(CODE, { errorCorrectionLevel: 'H', margin: 4, width: 480 }); });

  it('names only bundled fonts', () => {
    for (const d of THEMED_DESIGNS) {
      const t = THEMES[d];
      const extra = [t.eyebrow?.style, t.datecard?.month, t.datecard?.small, t.datecard?.day].filter((x) => !!x);
      for (const style of [t.title, t.primary, t.secondary, t.qr.label, t.when, t.where, ...extra]) expect(fontFileFor(style!.family, style!.weight)).toBeTruthy();
    }
  });

  it.each(THEMED_DESIGNS)('%s carries a QR code a scanner can read, and shows the event\'s own wording', async (design) => {
    const full = await renderThemedCard(design, { ...THEMES[design].sample, qr, useSampleLogo: true });
    expect(await sharp(full).metadata()).toMatchObject({ format: 'png', width: 786, height: 1364 });
    expect(await read(full)).toBe(CODE);
    const other = await renderThemedCard(design, { ...THEMES[design].sample, title: 'A Different Event', qr, useSampleLogo: true });
    expect((await pixels(other)).equals(await pixels(full))).toBe(false);
  });

  it.each(THEMED_DESIGNS)('%s is drawn with long or other-script wording, with only a title, and with nothing at all', async (design) => {
    const long = await renderThemedCard(design, {
      title: 'The Grand Annual Celebration of Culture and More', primary: 'অনুষ্ঠানে আপনাকে স্বাগতম – विशेष अतिथि', secondary: 'A very long second line of additional information that must be shortened',
      dateTime: 'Wednesday 31 December 2031 2:00 PM – Thursday 1 January 2032 4:00 PM', location: 'Netaji Indoor Stadium Convention Annexe, Gostha Paul Sarani, Near Eden Gardens, B.B.D. Bagh, Kolkata, West Bengal 700021, India',
      qr, useSampleLogo: true
    });
    expect(await read(long)).toBe(CODE);
    for (const input of [{ title: 'Only a title' }, {}, { logo: qr, dateTime: 'Soon' }]) {
      expect(await sharp(await renderThemedCard(design, input)).metadata()).toMatchObject({ width: 786, height: 1364 });
    }
  });

  it('puts the event\'s picture in a photo frame, whatever its shape', async () => {
    const photo = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#0a7f3f' } }).jpeg().toBuffer();
    const wide = await sharp({ create: { width: 900, height: 200, channels: 4, background: { r: 10, g: 20, b: 200, alpha: 1 } } }).png().toBuffer();
    const colourAt = async (png: Buffer, x: number, y: number) => {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
    };
    for (const design of ['BIRTHDAY_GOLD', 'BIRTHDAY_LILAC', 'BIRTHDAY_BLUSH', 'BIRTHDAY_RAINBOW'] as const) {
      const without = await renderThemedCard(design, { ...THEMES[design].sample, qr });
      for (const logo of [photo, wide]) {
        const card = await renderThemedCard(design, { ...THEMES[design].sample, qr, logo });
        expect(await read(card)).toBe(CODE);
        expect((await pixels(card)).equals(await pixels(without))).toBe(false);
      }
    }
    // the Personal & Family cards: round, eight-sided and oval frames, and a wreath
    for (const design of ['BABY_SHOWER', 'ANNAPRASAN', 'GRIHA_PRAVESH', 'ANNIVERSARY', 'ENGAGEMENT', 'HALDI', 'MEHENDI', 'SANGEET', 'WEDDING_RECEPTION'] as const) {
      const card = await renderThemedCard(design, { ...THEMES[design].sample, qr, logo: photo });
      expect(await read(card)).toBe(CODE);
      expect((await pixels(card)).equals(await pixels(await renderThemedCard(design, { ...THEMES[design].sample, qr })))).toBe(false);
    }
    // the rainbow card's round frame is at the top: its middle shows the picture
    const framedCard = await renderThemedCard('BIRTHDAY_RAINBOW', { ...THEMES.BIRTHDAY_RAINBOW.sample, date: THEMES.BIRTHDAY_RAINBOW.sampleDate, qr, logo: photo });
    const [r, g, b] = await colourAt(framedCard, 393, 246);
    expect(g).toBeGreaterThan(100);
    expect(r).toBeLessThan(60);
    expect(b).toBeLessThan(100);
  });

  it('has one card for every Personal & Family event type', () => {
    const subcategories = new Set(THEMED_DESIGNS.map((d) => THEMES[d]).filter((t) => t.category === 'Personal & Family').map((t) => t.subcategory));
    expect([...subcategories].sort()).toEqual(['Annaprasan', 'Anniversary', 'Baby Shower', 'Birthday', 'Engagement', 'Griha Pravesh', 'Haldi', 'Mehendi', 'Sangeet', 'Wedding Reception']);
  });

  it('has one card for every Education & Campus event type, each drawing the event\'s own logo', async () => {
    const education = THEMED_DESIGNS.filter((d) => THEMES[d].category === 'Education & Campus');
    expect(education.map((d) => THEMES[d].subcategory)).toEqual(['Convocation', "Freshers' Welcome", 'Farewell', 'College Fest']);
    const logo = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#0a7f3f' } }).jpeg().toBuffer();
    for (const design of education) {
      const card = await renderThemedCard(design, { ...THEMES[design].sample, qr, logo });
      expect(await read(card)).toBe(CODE);
      expect((await pixels(card)).equals(await pixels(await renderThemedCard(design, { ...THEMES[design].sample, qr })))).toBe(false);
    }
  });

  it('has one card for every Sports & Fitness event type, each drawing the event\'s own logo', async () => {
    const sports = THEMED_DESIGNS.filter((d) => THEMES[d].category === 'Sports & Fitness');
    expect(sports.map((d) => THEMES[d].subcategory)).toEqual(['Cricket Tournament', 'Football Tournament', 'Marathon', 'Fitness Event']);
    const logo = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#0a7f3f' } }).jpeg().toBuffer();
    for (const design of sports) {
      const card = await renderThemedCard(design, { ...THEMES[design].sample, qr, logo });
      expect(await read(card)).toBe(CODE);
      expect((await pixels(card)).equals(await pixels(await renderThemedCard(design, { ...THEMES[design].sample, qr })))).toBe(false);
    }
  });

  it('has one card for every Entertainment & Social event type, each drawing the event\'s own logo and date', async () => {
    const shows = THEMED_DESIGNS.filter((d) => THEMES[d].category === 'Entertainment & Social');
    expect(shows.map((d) => THEMES[d].subcategory)).toEqual(['Live Concert', 'Comedy Show', 'DJ Night', 'Food Festival', 'Exhibition']);
    const logo = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#0a7f3f' } }).jpeg().toBuffer();
    for (const design of shows) {
      const card = await renderThemedCard(design, { ...THEMES[design].sample, qr, logo });
      expect(await read(card)).toBe(CODE);
      expect((await pixels(card)).equals(await pixels(await renderThemedCard(design, { ...THEMES[design].sample, qr })))).toBe(false);
      expect((await pixels(card)).equals(await pixels(await renderThemedCard(design, { ...THEMES[design].sample, qr, logo, dateTime: 'Soon' })))).toBe(false);
    }
  });

  it('keeps the College Fest date and place on the ribbon and below it, whatever sits above', async () => {
    const foot = async (input: object) => sharp(await renderThemedCard('COLLEGE_FEST', { ...THEMES.COLLEGE_FEST.sample, ...input, qr })).extract({ left: 0, top: 990, width: 786, height: 374 }).raw().toBuffer();
    const full = await foot({});
    expect((await foot({ primary: '', secondary: '', title: 'Fest' })).equals(full)).toBe(true);
    expect((await foot({ dateTime: 'Sat 2 September 2028 4:00 PM – Sun 3 September 2028 9:00 PM' })).equals(full)).toBe(false);
  });

  it('gives the date in parts for a one-day event only', () => {
    expect(masterDateParts('2027-06-09T16:30:00.000Z', '2027-06-09T17:30:00.000Z')).toEqual({ month: 'June', weekday: 'Wednesday', day: '09', time: 'At 10:00 PM' });
    expect(masterDateParts('2027-06-09T16:30:00.000Z', '2027-06-12T17:30:00.000Z')).toBeNull();
    expect(masterDateParts(undefined, undefined)).toBeNull();
  });

  it('gives the guest page each card\'s own colours', () => {
    for (const d of THEMED_DESIGNS) expect(publicThemeFor(d)).toEqual({ design: d, ...THEMES[d].palette });
  });
});
