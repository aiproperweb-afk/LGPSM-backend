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
  Alexandria: [0.968, 0.251]
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
  const value = style.upper ? raw.toLocaleUpperCase() : raw;
  // (the font file must exist: a style naming a family that is not bundled would silently fall back to a system font)
  if (!fontFileFor(style.family, style.weight)) throw new Error(`No bundled font for ${style.family}`);
  const w = await fit(value, style.family, style.weight, style.size, style.min, style.lines, style.width ?? 345);
  return { w, style, height: w.lines.length * w.size * style.lh };
}

function textSvg({ w, style }: Fitted, top: number, s: number, centre: number = MASTER_WIDTH / 2): string {
  const [asc, desc] = METRICS[style.family] ?? METRICS.Inter;
  const line = w.size * style.lh;
  const baseline = (line - (asc + desc) * w.size) / 2 + asc * w.size;
  const tracking = style.tracking ? ` letter-spacing="${round(style.tracking * s)}"` : '';
  return w.lines
    .map((t, i) => `<text x="${round(centre * s)}" y="${round((top + i * line + baseline) * s)}" text-anchor="middle" font-family="${fontStack(style.family)}" font-weight="${style.weight}" font-size="${round(w.size * s)}"${tracking} fill="${style.color}">${escapeXml(t)}</text>`)
    .join('');
}

async function picture(input: Buffer, width: number, height: number, s: number) {
  return sharp(input, { failOn: 'none' }).rotate().resize(Math.round(width * s), Math.round(height * s), { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
}

/** The event's picture in the design's photo frame: it fills the opening when it is about square, else it stands whole on white. */
async function framed(logo: Buffer, inner: number, radius: number | undefined, s: number): Promise<Buffer> {
  const side = Math.round(inner * s);
  const upright = await sharp(logo, { failOn: 'none' }).rotate().png().toBuffer();
  const { width = 1, height = 1, isOpaque } = { ...(await sharp(upright).metadata()), ...(await sharp(upright).stats()) };
  const square = width / height > 0.74 && width / height < 1.35 && isOpaque;
  // in a circle, a picture that must stay whole is kept clear of the curve
  const room = square ? side : Math.round(side * (radius === undefined ? 0.7 : 0.86));
  const picture = await sharp(upright).resize(room, room, { fit: square ? 'cover' : 'inside' }).png().toBuffer({ resolveWithObject: true });
  const r = radius === undefined ? side / 2 : Math.round(radius * s);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${r}" fill="#fff"/></svg>`);
  const filled = await sharp({ create: { width: side, height: side, channels: 4, background: '#ffffff' } })
    .composite([{ input: picture.data, left: Math.round((side - picture.info.width) / 2), top: Math.round((side - picture.info.height) / 2) }]).png().toBuffer();
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
    const photo = logo ? await framed(logo, frame.inner, frame.radius, s) : null;
    return {
      key: 'logo',
      height: size,
      draw: (top, _svg, layers) => {
        if (art) centred(layers, art.data, art.info.width, art.info.height, top);
        if (photo) centred(layers, photo, Math.round(frame.inner * s), Math.round(frame.inner * s), top);
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
  return {
    key: 'qr',
    height: size + (label ? q.labelGap + label.height : 0),
    draw: (top, svg, layers) => {
      const boxTop = label && q.labelAbove ? top + label.height + q.labelGap : top;
      const x = (MASTER_WIDTH - size) / 2;
      svg.push(`<rect x="${round((x + q.borderWidth / 2) * s)}" y="${round((boxTop + q.borderWidth / 2) * s)}" width="${round((size - q.borderWidth) * s)}" height="${round((size - q.borderWidth) * s)}" rx="${round(q.radius * s)}" fill="#ffffff" stroke="${q.border}" stroke-width="${round(q.borderWidth * s)}"/>`);
      layers.push({ input: png, left: Math.round((x + q.inset) * s), top: Math.round((boxTop + q.inset) * s) });
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
      case 'when': return single(key, when, narrow(theme.when));
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
        return {
          key,
          height: (d?.height ?? 0) + between + (l?.height ?? 0),
          draw: (top, svg) => {
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
      case 'pin': return theme.pin && (when || where) ? imageBlock(key, theme.pin.file, theme.pin.size, theme.pin.size, s) : null;
      case 'divider': {
        const line = theme.divider;
        if (!line) return null;
        if (line.file) return imageBlock(key, line.file, line.width, line.height, s);
        return { key, height: line.height, draw: (top, svg) => { svg.push(`<rect x="${round(((MASTER_WIDTH - line.width) / 2) * s)}" y="${round(top * s)}" width="${round(line.width * s)}" height="${round(line.height * s)}" fill="${line.color}"/>`); } };
      }
    }
  };

  let blocks = (await Promise.all(theme.order.map(build))).filter((b): b is Block => !!b);
  // a divider with nothing on one side of it divides nothing
  blocks = blocks.filter((b, i) => b.key !== 'divider' || (i > 0 && i < blocks.length - 1));

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

  const base = await sharp(cached(`${theme.key}.jpg`)).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const composites: Layer[] = [];
  if (svg.length) composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg.join('')}</svg>`), left: 0, top: 0 });
  composites.push(...layers);
  return sharp(base).composite(composites).png({ compressionLevel: 6 }).toBuffer();
}
