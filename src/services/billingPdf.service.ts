import mongoose from 'mongoose';
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { Invoice } from '../models/Invoice';
import { Event } from '../models/Event';
import { User } from '../models/User';
import { ensureCardFonts, fontFileFor } from './cardTemplates/fonts';

// An organizer's billing document as a PDF: one invoice, or a statement of several payments for the SAME event. Payments for different
// events are never mixed into one file; the screens ask for one document per event.

export const MAX_INVOICES_PER_PDF = 200;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const INK = rgb(0, 0.043, 0.173);
const GREY = rgb(0.29, 0.329, 0.439);
const BLUE = rgb(0.122, 0.396, 1);
const LINE = rgb(0.88, 0.906, 0.949);
const PAGE = { w: 595.28, h: 841.89, margin: 48 };

const amount = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `INR ${amount(n)}`;
const day = (d: Date) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Writes text; what the PDF's own font cannot spell (Bengali, Devanagari and so on) is drawn as a picture with the card fonts */
async function writer(pdf: PDFDocument) {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pictures = new Map<string, { image: PDFImage; w: number; h: number }>();
  const spellable = (font: PDFFont, text: string) => { try { font.encodeText(text); return true; } catch { return false; } };

  async function picture(text: string, size: number, heavy: boolean, colour: typeof INK) {
    const key = `${text}|${size}|${heavy}|${colour.red}`;
    const hit = pictures.get(key);
    if (hit) return hit;
    await ensureCardFonts();
    const hex = [colour.red, colour.green, colour.blue].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const weight = heavy ? 700 : 400;
    const scale = 3; // drawn larger, shown smaller: sharp in print
    const fontfile = fontFileFor('Inter', weight);
    const png = await sharp({ text: { text: `<span foreground="#${hex}" font_weight="${weight}">${escaped}</span>`, font: `Inter, Noto Sans Bengali, Noto Sans Devanagari ${size}`, ...(fontfile ? { fontfile } : {}), dpi: 72 * scale, rgba: true } }).png().toBuffer();
    const meta = await sharp(png).metadata();
    const made = { image: await pdf.embedPng(png), w: (meta.width || 1) / scale, h: (meta.height || 1) / scale };
    pictures.set(key, made);
    return made;
  }

  /** `y` is the text's baseline; `width` cuts a long value with an ellipsis; `right` aligns the text so it ends at x */
  return async function text(page: PDFPage, value: string, x: number, y: number, o: { size?: number; heavy?: boolean; colour?: typeof INK; width?: number; right?: boolean } = {}) {
    const { size = 10, heavy = false, colour = INK, width, right = false } = o;
    const font = heavy ? bold : regular;
    let shown = value.replace(/\s+/g, ' ').trim();
    if (!shown) return;
    if (spellable(font, shown)) {
      if (width && font.widthOfTextAtSize(shown, size) > width) {
        while (shown.length > 1 && font.widthOfTextAtSize(`${shown}...`, size) > width) shown = shown.slice(0, -1);
        shown = `${shown}...`;
      }
      page.drawText(shown, { x: right ? x - font.widthOfTextAtSize(shown, size) : x, y, size, font, color: colour });
      return;
    }
    const p = await picture(shown, size, heavy, colour);
    const fit = width && p.w > width ? width / p.w : 1;
    page.drawImage(p.image, { x: right ? x - p.w * fit : x, y: y - p.h * fit * 0.22, width: p.w * fit, height: p.h * fit });
  };
}

export async function buildBillingPdf(organizerId: string, invoiceIds: string[]): Promise<{ pdf: Buffer; fileName: string }> {
  const ids = [...new Set(invoiceIds)].filter((i) => mongoose.Types.ObjectId.isValid(i));
  if (ids.length === 0) throw fail(400, 'Choose at least one invoice.');
  if (ids.length > MAX_INVOICES_PER_PDF) throw fail(400, `A statement holds up to ${MAX_INVOICES_PER_PDF} invoices. Choose a shorter period.`);
  // only the organizer's own invoices are ever found
  const invoices: any[] = await Invoice.find({ _id: { $in: ids }, userId: organizerId }).sort({ issuedAt: 1 }).lean();
  if (invoices.length !== ids.length) throw fail(404, 'Invoice not found.');
  if (new Set(invoices.map((i) => String(i.eventId))).size > 1) throw fail(400, 'One document covers one event. Download each event separately.');

  const [event, organizer]: any[] = await Promise.all([
    Event.findById(invoices[0].eventId).select('title').lean(),
    User.findById(organizerId).select('fullName email profile.organizationName').lean()
  ]);
  const eventName: string = event?.title || invoices[0].eventName || 'Event';
  const single = invoices.length === 1;

  const pdf = await PDFDocument.create();
  pdf.setTitle(single ? `Invoice ${invoices[0].invoiceNumber}` : `Billing statement: ${eventName}`);
  pdf.setCreator('EventQRapp');
  const text = await writer(pdf);
  const left = PAGE.margin;
  const right = PAGE.w - PAGE.margin;
  // column left edges; the money columns are right-aligned to their right edges
  const col = { id: left, date: left + 140, guests: left + 218, subtotal: left + 346, tax: left + 420, total: right };

  let page!: PDFPage;
  let y = 0;
  const rule = () => page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.8, color: LINE });
  const tableHead = async () => {
    await text(page, 'Invoice ID', col.id, y, { heavy: true, size: 9, colour: GREY });
    await text(page, 'Payment date', col.date, y, { heavy: true, size: 9, colour: GREY });
    await text(page, 'Invitees', col.guests, y, { heavy: true, size: 9, colour: GREY });
    // the currency is named once in the headings, so large amounts keep clear of each other
    await text(page, 'Subtotal (INR)', col.subtotal, y, { heavy: true, size: 9, colour: GREY, right: true });
    await text(page, 'GST (INR)', col.tax, y, { heavy: true, size: 9, colour: GREY, right: true });
    await text(page, 'Total (INR)', col.total, y, { heavy: true, size: 9, colour: GREY, right: true });
    y -= 8; rule(); y -= 18;
  };
  const newPage = async () => { page = pdf.addPage([PAGE.w, PAGE.h]); y = PAGE.h - PAGE.margin - 16; };

  await newPage();
  await text(page, 'EventQRapp', left, y, { heavy: true, size: 18, colour: BLUE });
  await text(page, single ? 'Invoice' : 'Billing Statement', right, y, { heavy: true, size: 18, right: true });
  y -= 18;
  await text(page, `Issued ${day(new Date())}`, right, y, { size: 9, colour: GREY, right: true });
  y -= 30;
  await text(page, 'Billed to', left, y, { size: 9, colour: GREY });
  y -= 15;
  await text(page, organizer?.profile?.organizationName || organizer?.fullName || 'Organizer', left, y, { heavy: true, size: 12, width: 480 });
  y -= 14;
  await text(page, organizer?.email || '', left, y, { size: 10, colour: GREY });
  y -= 28;
  await text(page, 'Event', left, y, { size: 9, colour: GREY });
  y -= 15;
  await text(page, eventName, left, y, { heavy: true, size: 12, width: right - left });
  y -= 32;
  await tableHead();

  for (const i of invoices) {
    if (y < PAGE.margin + 90) { await newPage(); await tableHead(); }
    await text(page, i.invoiceNumber, col.id, y, { width: 134 });
    await text(page, day(i.issuedAt), col.date, y);
    await text(page, String(i.invitees ?? 0), col.guests, y);
    await text(page, amount(i.subtotal), col.subtotal, y, { right: true });
    await text(page, amount(i.tax), col.tax, y, { right: true });
    await text(page, amount(i.total), col.total, y, { right: true });
    y -= 10; rule(); y -= 18;
  }

  const sum = (k: 'subtotal' | 'tax' | 'total') => invoices.reduce((s, i) => s + (i[k] || 0), 0);
  y -= 6;
  for (const [label, value, heavy] of [['Subtotal', sum('subtotal'), false], ['GST', sum('tax'), false], ['Total paid', sum('total'), true]] as const) {
    await text(page, label, col.guests, y, { heavy, size: heavy ? 12 : 10, colour: heavy ? INK : GREY });
    await text(page, money(value), col.total, y, { right: true, heavy, size: heavy ? 12 : 10 });
    y -= heavy ? 20 : 16;
  }
  y -= 24;
  await text(page, 'Paid online. Amounts are in Indian rupees (INR).', left, y, { size: 9, colour: GREY });

  const safe = eventName.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  const fileName = single ? `invoice-${invoices[0].invoiceNumber}.pdf` : `statement-${safe}.pdf`;
  return { pdf: Buffer.from(await pdf.save()), fileName };
}
