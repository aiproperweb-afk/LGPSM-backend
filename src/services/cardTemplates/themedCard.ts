import fs from 'fs';
import sharp from 'sharp';
import { assetPath } from '../../utils/assetPath';
import { ensureCardFonts, fontStack, fontFileFor } from './fonts';
import { clean, escapeXml, fit, MASTER_HEIGHT, MASTER_WIDTH, MasterCardInput, Wrapped } from './masterCard';
import { THEMES, ThemedDesign, TextStyle, ThemeBlock, CardTheme } from './themes';

/**
 * Draws a themed card (themes.ts) with the event's details. Like the master card, nothing sits in a fixed slot: a detail that is
 * switched off or empty leaves no hole, the column closes up and stays centred in the space the design gives it.
 */
const SCALE_DEFAULT = 2;
const QR_MIN = 96;

type Layer = { input: Buffer; left: number; top: number };
interface Block {
  key: ThemeBlock;
  height: number;
  draw: (top: number, svg: string[], layers: Layer[]) => void;
}

// where the baseline sits in a line, per bundled family: [ascent, descent] in em (from the fonts' own metrics)
const METRICS: Record<string, [number, number]> = {
  Inter: [0.969, 0.241], Poppins: [1.05, 0.35], Montserrat: [0.968, 0.251], Judson: [0.908, 0.255],
  'Lobster Two': [1.0, 0.25], Alice: [0.909, 0.234], 'Luckiest Guy': [0.703, 0.297],
  Alkatra: [1.095, 0.589], 'Abril Fatface': [1.058, 0.291], Nunito: [1.011, 0.353], Chewy: [0.979, 0.303], 'Young Serif': [1.046, 0.366],
  Alexandria: [0.968, 0.251],
  Birthstone: [0.9, 0.35], 'Abhaya Libre ExtraBold': [0.84, 0.34], 'Alan Sans': [0.99, 0.31], 'Alegreya SC': [1.016, 0.345], Aleo: [0.905, 0.295],
  'Ancizar Serif': [0.9, 0.3], 'Berkshire Swash': [0.98, 0.262], 'Bigshot One': [0.869, 0.179], Chonburi: [0.95, 0.25], Cinzel: [0.976, 0.372],
  'Cinzel Decorative': [0.976, 0.372], 'IM Fell Great Primer': [0.948, 0.274],
  'Inria Serif': [0.976, 0.223], 'Inknut Antiqua': [1.703, 0.876], 'Bebas Neue': [0.9, 0.3], Kalnia: [1.045, 0.3], 'Kantumruy Pro': [0.92, 0.26],
  Tomorrow: [1.0, 0.2], 'Tomorrow Medium': [1.0, 0.2], 'BBH Hegarty': [0.95, 0.25], 'BBH Bogle': [0.95, 0.25], 'BBH Bartle': [0.95, 0.25],
  Koulen: [1.221, 0.586], 'Kode Mono': [0.98, 0.3], 'Iosevka Charon Mono': [1.015, 0.265]
};

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const cache = new Map<string, Buffer>();
const cached = (file: string) => {
  let data = cache.get(file);
  if (!data) cache.set(file, (data = fs.readFileSync(assetPath('cardTemplates', 'themes', file))));
  return data;
};

interface Fitted { w: Wrapped; style: TextStyle; height: number }

async function fitted(raw: string, style: TextStyle): Promise<Fitted> {
  const cased = style.upper ? raw.toLocaleUpperCase() : raw;
  // a time and its AM/PM stay on one line
  const value = cased.replace(/(\d:\d\d) (AM|PM)\b/g, '$1\u00a0$2');
  // (the font file must exist: a style naming a family that is not bundled would silently fall back to a system font)
  if (!fontFileFor(style.family, style.weight)) throw new Error(`No bundled font for ${style.family}`);
  const wrap = (width: number, size = style.size, min = style.min) => fit(value, style.family, style.weight, size, min, style.lines, width, style.tracking);
  const full = style.width ?? 345;
  let w = await wrap(full);
  // the narrowest width that still takes as many lines, at the size just found
  for (let width = full - 10; style.balance && w.lines.length > 1 && width > full / 2; width -= 10) {
    const next = await wrap(width, w.size, w.size);
    if (next.lines.length !== w.lines.length || next.lines.some((l) => l.endsWith('…'))) break;
    w = next;
  }
  return { w, style, height: w.lines.length * w.size * style.lh };
}

function textSvg({ w, style }: Fitted, top: number, s: number, centre: number = MASTER_WIDTH / 2): string {
  const [asc, desc] = METRICS[style.family] ?? METRICS.Inter;
  const line = w.size * style.lh;
  const baseline = (line - (asc + desc) * w.size) / 2 + asc * w.size;
  const tracking = style.tracking ? ` letter-spacing="${round(style.tracking * s)}"` : '';
  // (a border is the same words drawn first with a stroke: half of it shows around the letters laid over it)
  const edge = style.outline ? `fill="${style.outline.color}" stroke="${style.outline.color}" stroke-width="${round(style.outline.width * s)}" stroke-linejoin="round"` : null;
  return w.lines
    .map((t, i) => {
      const at = `x="${round(centre * s)}" y="${round((top + i * line + baseline) * s)}" text-anchor="middle" font-family="${fontStack(style.family)}" font-weight="${style.weight}" font-size="${round(w.size * s)}"${tracking}`;
      return `${edge ? `<text ${at} ${edge}>${escapeXml(t)}</text>` : ''}<text ${at} fill="${style.color}">${escapeXml(t)}</text>`;
    })
    .join('');
}

async function picture(input: Buffer, width: number, height: number, s: number) {
  return sharp(input, { failOn: 'none' }).rotate().resize(Math.round(width * s), Math.round(height * s), { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
}

/**
 * The event's picture in the design's photo frame: it fills the opening when it is about square, else it stands whole on white. The opening is
 * a circle, a rounded square when `radius` is given, or an oval when it is taller than it is wide (`innerHeight`).
 */
async function framed(logo: Buffer, inner: number, radius: number | undefined, s: number, innerHeight: number = inner): Promise<Buffer> {
  const side = Math.round(inner * s);
  const tall = Math.round(innerHeight * s);
  const upright = await sharp(logo, { failOn: 'none' }).rotate().png().toBuffer();
  const { width = 1, height = 1, isOpaque } = { ...(await sharp(upright).metadata()), ...(await sharp(upright).stats()) };
  const square = width / height > 0.74 && width / height < 1.35 && isOpaque;
  // in a circle, a picture that must stay whole is kept clear of the curve
  const room = square ? side : Math.round(side * (radius === undefined ? 0.7 : 0.86));
  const roomTall = square ? tall : room;
  const picture = await sharp(upright).resize(room, roomTall, { fit: square ? 'cover' : 'inside' }).png().toBuffer({ resolveWithObject: true });
  const opening = radius === undefined
    ? `<ellipse cx="${side / 2}" cy="${tall / 2}" rx="${side / 2}" ry="${tall / 2}" fill="#fff"/>`
    : `<rect width="${side}" height="${tall}" rx="${Math.round(radius * s)}" fill="#fff"/>`;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${tall}">${opening}</svg>`);
  const filled = await sharp({ create: { width: side, height: tall, channels: 4, background: '#ffffff' } })
    .composite([{ input: picture.data, left: Math.round((side - picture.info.width) / 2), top: Math.round((tall - picture.info.height) / 2) }]).png().toBuffer();
  return sharp(filled).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function logoBlock(theme: CardTheme, logo: Buffer | null, sample: boolean, s: number): Promise<Block | null> {
  const { size, circle, frame } = theme.logo;
  const centred = (layers: Layer[], png: Buffer, width: number, height: number, top: number) =>
    layers.push({ input: png, left: Math.round((MASTER_WIDTH * s - width) / 2), top: Math.round(top * s + (size * s - height) / 2) });
  if (frame) {
    if (!logo && !(sample && !theme.logo.noSample)) return null;
    // without the event's own picture, a preview shows the designers' whole frame and picture
    const art = logo ? (frame.art ? await picture(cached(`${frame.art}.png`), size, size, s) : null) : await picture(cached(`${theme.key}.logo.png`), size, size, s);
    const photo = logo ? await framed(logo, frame.inner, frame.radius, s, frame.innerHeight) : null;
    return {
      key: 'logo',
      height: size,
      draw: (top, _svg, layers) => {
        if (art) centred(layers, art.data, art.info.width, art.info.height, top);
        if (photo) centred(layers, photo, Math.round(frame.inner * s), Math.round((frame.innerHeight ?? frame.inner) * s), top);
      }
    };
  }
  const source = logo ?? (sample && !theme.logo.noSample ? cached(`${theme.key}.logo.png`) : null);
  // (a design with a ring and no sample picture previews the empty ring)
  if (!source && !(circle && sample)) return null;
  // in a circle the logo stays inside it, whole; otherwise it is up to `size` tall and wider when the logo is
  const png = source ? await picture(source, circle ? size * 0.7 : size * 2.2, circle ? size * 0.7 : size, s) : null;
  return {
    key: 'logo',
    height: size,
    draw: (top, svg, layers) => {
      if (circle) svg.push(`<circle cx="${round((MASTER_WIDTH / 2) * s)}" cy="${round((top + size / 2) * s)}" r="${round((size / 2 - 0.5) * s)}" fill="#ffffff" stroke="${circle.border}" stroke-width="${round(s)}"/>`);
      if (png) centred(layers, png.data, png.info.width, png.info.height, top);
    }
  };
}

async function qrBlock(theme: CardTheme, qr: Buffer, scanLabel: string, size: number, s: number): Promise<Block> {
  const q = theme.qr;
  const inner = Math.round((size - 2 * q.inset) * s);
  const png = await sharp(qr, { failOn: 'none' }).resize(inner, inner, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  const label = q.labelText ? await fitted(scanLabel, q.label) : null;
  // a design with an ornamental border draws it around a plain white square
  const art = q.art ? await picture(cached(`${q.art}.png`), size, size, s) : null;
  return {
    key: 'qr',
    height: size + (label ? q.labelGap + label.height : 0),
    draw: (top, svg, layers) => {
      const boxTop = label && q.labelAbove ? top + label.height + q.labelGap : top;
      const x = (MASTER_WIDTH - size) / 2;
      if (art) svg.push(`<rect x="${round((x + q.inset) * s)}" y="${round((boxTop + q.inset) * s)}" width="${round((size - 2 * q.inset) * s)}" height="${round((size - 2 * q.inset) * s)}" fill="#ffffff"/>`);
      else svg.push(`<rect x="${round((x + q.borderWidth / 2) * s)}" y="${round((boxTop + q.borderWidth / 2) * s)}" width="${round((size - q.borderWidth) * s)}" height="${round((size - q.borderWidth) * s)}" rx="${round(q.radius * s)}" fill="#ffffff" stroke="${q.border}" stroke-width="${round(q.borderWidth * s)}"/>`);
      layers.push({ input: png, left: Math.round((x + q.inset) * s), top: Math.round((boxTop + q.inset) * s) });
      if (art) layers.push({ input: art.data, left: Math.round((MASTER_WIDTH * s - art.info.width) / 2), top: Math.round(boxTop * s) });
      if (label) svg.push(textSvg(label, q.labelAbove ? top : boxTop + size + q.labelGap, s));
    }
  };
}

async function imageBlock(key: ThemeBlock, file: string, width: number, height: number, s: number): Promise<Block> {
  const png = await picture(cached(`${file}.png`), width, height, s);
  return { key, height, draw: (top, _svg, layers) => { layers.push({ input: png.data, left: Math.round((MASTER_WIDTH * s - png.info.width) / 2), top: Math.round(top * s) }); } };
}

export async function renderThemedCard(design: ThemedDesign, input: MasterCardInput): Promise<Buffer> {
  await ensureCardFonts();
  const theme = THEMES[design];
  const s = input.scale && input.scale > 0 ? input.scale : SCALE_DEFAULT;
  const width = Math.round(MASTER_WIDTH * s);
  const height = Math.round(MASTER_HEIGHT * s);

  const title = clean(input.title);
  const primary = clean(input.primary);
  const secondary = clean(input.secondary);
  const when = clean(input.dateTime);
  const where = clean(input.location);
  const logo = input.logo || null;
  const date = theme.datecard && when ? input.date : null;
  const qr = input.qr || null;
  const scanLabel = clean(input.scanLabel) || theme.qr.labelText;

  const narrow = (style: TextStyle): TextStyle => (!qr && theme.detailsWidthNoQr ? { ...style, width: theme.detailsWidthNoQr, lines: style.lines + 1 } : style);

  const single = async (key: ThemeBlock, value: string, style: TextStyle): Promise<Block | null> => {
    if (!value) return null;
    const f = await fitted(value, style);
    return { key, height: f.height, draw: (top, svg) => { svg.push(textSvg(f, top, s)); } };
  };

  const build = async (key: ThemeBlock): Promise<Block | null> => {
    switch (key) {
      case 'logo': return logoBlock(theme, logo, input.useSampleLogo === true, s);
      case 'title': return single(key, title, theme.title);
      case 'eyebrow': return theme.eyebrow ? single(key, theme.eyebrow.text, theme.eyebrow.style) : null;
      case 'datecard': {
        if (!when) return null;
        // more than one day: the whole date and time, in words
        if (!date || !theme.datecard) return single(key, when, theme.when);
        const card = theme.datecard;
        const [month, weekday, day, time] = await Promise.all([fitted(date.month, card.month), fitted(date.weekday, card.small), fitted(date.day, card.day), fitted(date.time, card.small)]);
        const row = day.height;
        return {
          key,
          height: month.height + card.gap + row,
          draw: (top, svg) => {
            const y = top + month.height + card.gap;
            svg.push(textSvg(month, top, s));
            svg.push(textSvg(weekday, y + (row - weekday.height) / 2, s, 117.5), textSvg(day, y, s, 197), textSvg(time, y + (row - time.height) / 2, s, 271));
            for (const x of [173, 221]) svg.push(`<line x1="${round(x * s)}" y1="${round(y * s)}" x2="${round(x * s)}" y2="${round((y + row) * s)}" stroke="${card.rule}" stroke-width="${round(2 * s)}"/>`);
          }
        };
      }
      case 'when': {
        if (theme.whenRange && /\d{4}.*\d{4}/.test(when)) return single(key, when, theme.whenRange);
        // one day: the time and the date each on their own line, where the design sets them so
        const [, day, hours] = (theme.whenBelow && /^(.*?\b\d{4}) (\d{1,2}:\d\d.*)$/.exec(when)) || [];
        if (!theme.whenBelow || !day || /\d{4}/.test(hours)) return single(key, when, narrow(theme.when));
        const [a, b] = await Promise.all([fitted(hours, theme.when), fitted(day, theme.whenBelow)]);
        const rule = theme.whenBelowRule;
        const between = rule?.gap ?? 0;
        return {
          key,
          height: a.height + between + b.height,
          draw: (top, svg) => {
            svg.push(textSvg(a, top, s), textSvg(b, top + a.height + between, s));
            if (rule) svg.push(`<rect x="${round(((MASTER_WIDTH - rule.width) / 2) * s)}" y="${round((top + a.height + rule.offset - 0.5) * s)}" width="${round(rule.width * s)}" height="${round(s)}" fill="${rule.color}"/>`);
          }
        };
      }
      case 'where': return single(key, where, narrow(theme.where));
      case 'qr': return qr ? qrBlock(theme, qr, scanLabel, theme.qr.size, s) : null;
      case 'info': {
        if (!primary && !secondary) return null;
        const a = primary ? await fitted(primary, theme.primary) : null;
        const b = secondary ? await fitted(secondary, theme.secondary) : null;
        const gap = a && b ? theme.infoGap : 0;
        return {
          key,
          height: (a?.height ?? 0) + gap + (b?.height ?? 0),
          draw: (top, svg) => { if (a) svg.push(textSvg(a, top, s)); if (b) svg.push(textSvg(b, top + (a?.height ?? 0) + gap, s)); }
        };
      }
      case 'details': {
        if (!when && !where) return null;
        const d = when ? await fitted(when, narrow(theme.when)) : null;
        const l = where ? await fitted(where, narrow(theme.where)) : null;
        const rule = d && l ? theme.rule : undefined;
        const between = rule ? rule.gapBefore + 1 + rule.gapAfter : d && l ? theme.detailsGap ?? 8 : 0;
        const box = theme.box;
        const pad = box?.padY ?? 0;
        const inside = (d?.height ?? 0) + between + (l?.height ?? 0);
        return {
          key,
          height: inside + 2 * pad,
          draw: (start, svg) => {
            if (box) {
              const stroke = box.colorEnd ? 'url(#box-border)' : box.color;
              if (box.colorEnd) svg.push(`<linearGradient id="box-border" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${box.color}"/><stop offset="1" stop-color="${box.colorEnd}"/></linearGradient>`);
              svg.push(`<rect x="${round(((MASTER_WIDTH - box.width) / 2) * s)}" y="${round(start * s)}" width="${round(box.width * s)}" height="${round((inside + 2 * pad) * s)}" rx="${round(box.radius * s)}" fill="none" stroke="${stroke}" stroke-width="${round((box.borderWidth ?? 1) * s)}"/>`);
            }
            const top = start + pad;
            if (d) svg.push(textSvg(d, top, s));
            if (rule) {
              const y = round((top + d!.height + rule.gapBefore + 0.5) * s);
              svg.push(`<line x1="${round(((MASTER_WIDTH - rule.width) / 2) * s)}" y1="${y}" x2="${round(((MASTER_WIDTH + rule.width) / 2) * s)}" y2="${y}" stroke="${rule.color}" stroke-opacity="${rule.opacity}" stroke-width="${round(s)}"/>`);
            }
            if (l) svg.push(textSvg(l, top + (d?.height ?? 0) + between, s));
          }
        };
      }
      // ornaments: only beside the details they belong to
      // (a pin fixed above the location's own place means nothing without a location)
      case 'pin': return theme.pin && (theme.anchor?.pin ? where : when || where) ? imageBlock(key, theme.pin.file, theme.pin.size, theme.pin.height ?? theme.pin.size, s) : null;
      case 'divider':
      case 'divider2': {
        const line = theme.divider;
        if (!line) return null;
        if (line.file) return imageBlock(key, line.file, line.width, line.height, s);
        return { key, height: line.height, draw: (top, svg) => { svg.push(`<rect x="${round(((MASTER_WIDTH - line.width) / 2) * s)}" y="${round(top * s)}" width="${round(line.width * s)}" height="${round(line.height * s)}" fill="${line.color}"/>`); } };
      }
    }
  };

  const all = (await Promise.all(theme.order.map(build))).filter((b): b is Block => !!b);
  // blocks the design fixes to a part of its artwork are not in the column
  const anchored = all.filter((b) => theme.anchor?.[b.key]);
  let blocks = all.filter((b) => !theme.anchor?.[b.key]);
  // a divider with nothing on one side of it divides nothing
  blocks = blocks.filter((b, i) => (b.key !== 'divider' && b.key !== 'divider2') || (i > 0 && i < blocks.length - 1));

  const gaps = blocks.map((b, i) => (i === 0 ? 0 : theme.gaps[b.key] ?? 0));
  const total = () => sum(blocks.map((b) => b.height)) + sum(gaps);
  const room = theme.safe[1] - theme.safe[0];
  // too much to fit: the QR box shrinks first, then the gaps
  const qrIndex = blocks.findIndex((b) => b.key === 'qr');
  if (qrIndex >= 0) {
    for (let size = theme.qr.size - 8; size >= QR_MIN && total() > room; size -= 8) blocks[qrIndex] = await qrBlock(theme, qr!, scanLabel, size, s);
  }
  const squeeze = total() > room ? Math.max(0.2, (room - sum(blocks.map((b) => b.height))) / Math.max(1, sum(gaps))) : 1;
  const used = sum(blocks.map((b) => b.height)) + sum(gaps) * squeeze;
  const region = !qr && theme.regionNoQr ? theme.regionNoQr : theme.region;
  let y = Math.max(theme.safe[0], Math.min((region[0] + region[1] - used) / 2, theme.safe[1] - used));

  const svg: string[] = [];
  const layers: Layer[] = [];
  blocks.forEach((block, i) => {
    y += gaps[i] * squeeze;
    block.draw(y, svg, layers);
    y += block.height;
  });
  for (const block of anchored) {
    const at = theme.anchor![block.key]!;
    block.draw('top' in at ? at.top : at.middle - block.height / 2, svg, layers);
  }

  const base = await sharp(cached(`${theme.key}.jpg`)).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const composites: Layer[] = [];
  if (svg.length) composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg.join('')}</svg>`), left: 0, top: 0 });
  composites.push(...layers);
  return sharp(base).composite(composites).png({ compressionLevel: 6 }).toBuffer();
}
