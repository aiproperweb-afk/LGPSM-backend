import mongoose from 'mongoose';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { Category } from '../../models/Category';
import { Template, CardDesign } from '../../models/Template';
import { Media, MediaPurpose } from '../../models/Media';
import { User, Role } from '../../models/User';
import { renderTemplateCard, sampleTexts, isTemplateDesign } from './renderer';
import { renderMasterCard, MASTER_SAMPLE } from './masterCard';
import { renderThemedCard } from './themedCard';
import { isThemedDesign, THEMED_DESIGNS, THEMES } from './themes';

// The invitation templates the designers made (Event Management Invitation Card.fig), as ready-to-use template
// records. Installing them creates what is missing and never changes or removes anything that already exists:
//  - a template is skipped when one with the same design already exists for the same event type;
//  - categories and subcategories are matched by name (ignoring case) and only created when absent.
//
// The master card is not tied to an event type, so it suits every event. The themed cards (themes.ts) each belong to a
// category and subcategory. The designs made before the master card (corporate, wedding, rice ceremony, birthday) still
// render for events that were created with them in the full-set mode, but are not installed.

export interface DefaultTemplateSpec {
  key: string;
  name: string;
  cardDesign: CardDesign;
  /** Absent: the template suits every event type */
  category?: string;
  subcategory?: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplateSpec[] = [
  { key: 'master-card', name: 'Master Card', cardDesign: 'MASTER' },
  ...THEMED_DESIGNS.map((design) => ({ key: THEMES[design].key, name: THEMES[design].name, cardDesign: design, category: THEMES[design].category, subcategory: THEMES[design].subcategory }))
];

export interface DefaultTemplatePlan {
  templatesToCreate: Array<{ name: string; cardDesign: string; category?: string; subcategory?: string }>;
  templatesPresent: string[];
  categoriesToCreate: string[];
  subcategoriesToCreate: Array<{ category: string; subcategory: string }>;
}

const same = (a?: string, b?: string) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const findCategory = <T extends { name: string }>(cats: T[], name: string) => cats.find((c) => same(c.name, name));

/** What installing would do, without changing anything. */
export async function planDefaultTemplates(): Promise<DefaultTemplatePlan> {
  const categories = await Category.find({ ownerId: null }).select('name subcategories').lean();
  const templates = await Template.find({ isActive: { $ne: false } }).select('cardDesign categoryId subcategoryId').lean();
  const plan: DefaultTemplatePlan = { templatesToCreate: [], templatesPresent: [], categoriesToCreate: [], subcategoriesToCreate: [] };
  const plannedCategories = new Set<string>();
  const plannedSubs = new Set<string>();

  for (const spec of DEFAULT_TEMPLATES) {
    if (!spec.category) {
      // not tied to an event type
      if (templates.some((t) => t.cardDesign === spec.cardDesign && !t.categoryId)) plan.templatesPresent.push(spec.name);
      else plan.templatesToCreate.push({ name: spec.name, cardDesign: spec.cardDesign });
      continue;
    }
    const category = findCategory(categories, spec.category);
    const sub = spec.subcategory ? category?.subcategories?.find((s) => same(s.name, spec.subcategory)) : undefined;
    if (!category && !plannedCategories.has(spec.category.toLowerCase())) {
      plannedCategories.add(spec.category.toLowerCase());
      plan.categoriesToCreate.push(spec.category);
    }
    if (spec.subcategory && !sub && !plannedSubs.has(`${spec.category}/${spec.subcategory}`.toLowerCase())) {
      plannedSubs.add(`${spec.category}/${spec.subcategory}`.toLowerCase());
      // a brand-new category is created together with its subcategories, so only report subcategories of existing categories
      if (category) plan.subcategoriesToCreate.push({ category: spec.category, subcategory: spec.subcategory });
    }
    const exists =
      !!category &&
      templates.some(
        (t) =>
          t.cardDesign === spec.cardDesign &&
          String(t.categoryId || '') === String(category._id) &&
          String(t.subcategoryId || '') === String(sub?._id || '')
      );
    if (exists) plan.templatesPresent.push(spec.name);
    else plan.templatesToCreate.push({ name: spec.name, cardDesign: spec.cardDesign, category: spec.category, subcategory: spec.subcategory });
  }
  return plan;
}

// A small JPEG of the design with the designers' sample text, stored as media so web and mobile can show it
async function storePreview(spec: DefaultTemplateSpec, ownerId: string): Promise<string> {
  const originalName = `default-template:${spec.key}`;
  const existing = await Media.findOne({ purpose: MediaPurpose.TEMPLATE, originalName }).select('_id');
  if (existing) return `media:${existing._id}`;

  const qr = await QRCode.toBuffer('https://lgpsm.example/sample-card-not-a-real-invitation', { errorCorrectionLevel: 'H', margin: 4, width: 400 });
  let png: Buffer;
  if (spec.cardDesign === 'MASTER') {
    png = await renderMasterCard({ ...MASTER_SAMPLE, qr, useSampleLogo: true, scale: 1.5 });
  } else if (isThemedDesign(spec.cardDesign)) {
    const theme = THEMES[spec.cardDesign];
    png = await renderThemedCard(spec.cardDesign, { ...theme.sample, date: theme.sampleDate, qr, useSampleLogo: true, scale: 1.5 });
  } else {
    if (!isTemplateDesign(spec.cardDesign)) throw new Error(`No artwork for design ${spec.cardDesign}`);
    png = await renderTemplateCard({ design: spec.cardDesign, texts: sampleTexts(spec.cardDesign), qr, scale: 1.5, useSamplePhoto: true });
  }
  const { data, info } = await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const media = await Media.create({
    ownerId: new mongoose.Types.ObjectId(ownerId),
    purpose: MediaPurpose.TEMPLATE,
    contentType: 'image/jpeg',
    size: info.size,
    width: info.width,
    height: info.height,
    originalName,
    data
  });
  return `media:${media._id}`;
}

let ensuring: Promise<string | null> | null = null;

/**
 * Installs the shared designs a database does not have yet (an administrator owns their preview pictures), so they appear without a manual
 * step. A themed card an administrator deleted stays deleted; the master card, which every event can fall back to, is always there.
 * Returns the master card's template id, or null when there is no administrator account to own the pictures.
 */
export function ensureSharedTemplates(): Promise<string | null> {
  if (!ensuring) {
    ensuring = (async () => {
      const master = () => Template.findOne({ cardDesign: 'MASTER', isActive: { $ne: false } }).select('_id').lean();
      const existing = await master();
      // (deleted templates still count here)
      const everInstalled = new Set(await Template.distinct('cardDesign', { cardDesign: { $in: THEMED_DESIGNS } }));
      const wanted = DEFAULT_TEMPLATES.filter((t) => (t.cardDesign === 'MASTER' ? !existing : !everInstalled.has(t.cardDesign)));
      if (wanted.length === 0) return existing ? String(existing._id) : null;
      const admin = await User.findOne({ role: Role.ADMIN, isActive: { $ne: false } }).select('_id').lean();
      if (!admin) return existing ? String(existing._id) : null;
      try {
        await installDefaultTemplates(String(admin._id), new Set(wanted.map((t) => t.key)));
      } catch (err) {
        // the list and event creation carry on with what is there; the next request tries again
        console.warn('[cards] The shared templates could not all be installed:', err instanceof Error ? err.message : 'unknown error');
      }
      const installed = await master();
      return installed ? String(installed._id) : null;
    })().finally(() => { ensuring = null; });
  }
  return ensuring;
}

/** The master card's template id, installing the shared designs first when needed. */
export const ensureMasterTemplate = ensureSharedTemplates;

export interface InstallResult extends DefaultTemplatePlan {
  created: string[];
}

export async function installDefaultTemplates(ownerId: string, only?: Set<string>): Promise<InstallResult> {
  const plan = await planDefaultTemplates();
  const created: string[] = [];

  for (const spec of DEFAULT_TEMPLATES) {
    if ((only && !only.has(spec.key)) || !plan.templatesToCreate.some((t) => t.name === spec.name)) continue;

    if (!spec.category) {
      if (await Template.exists({ cardDesign: spec.cardDesign, categoryId: { $exists: false }, isActive: { $ne: false } })) continue;
      await Template.create({
        name: spec.name,
        cardDesign: spec.cardDesign,
        previewImageKey: await storePreview(spec, ownerId),
        isSystemTemplate: true,
        isPublished: true,
        isActive: true
      });
      created.push(spec.name);
      continue;
    }

    // category (with the subcategory it needs), created only when absent
    let category = await Category.findOne({ ownerId: null, name: new RegExp(`^${spec.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!category) {
      category = await Category.create({ name: spec.category, isActive: true, subcategories: spec.subcategory ? [{ name: spec.subcategory, isActive: true }] : [] });
    }
    let subcategoryId: mongoose.Types.ObjectId | undefined;
    if (spec.subcategory) {
      let sub = category.subcategories.find((s) => same(s.name, spec.subcategory));
      if (!sub) {
        category.subcategories.push({ name: spec.subcategory, isActive: true });
        await category.save();
        sub = category.subcategories.find((s) => same(s.name, spec.subcategory));
      }
      subcategoryId = sub?._id;
    }

    // Another admin may have installed it a moment ago
    const duplicate = await Template.exists({ cardDesign: spec.cardDesign, categoryId: category._id, ...(subcategoryId ? { subcategoryId } : { subcategoryId: { $exists: false } }), isActive: { $ne: false } });
    if (duplicate) continue;

    await Template.create({
      name: spec.name,
      categoryId: category._id,
      ...(subcategoryId ? { subcategoryId } : {}),
      cardDesign: spec.cardDesign,
      previewImageKey: await storePreview(spec, ownerId),
      isSystemTemplate: true,
      isPublished: true,
      isActive: true
    });
    created.push(spec.name);
  }
  return { ...plan, created };
}
