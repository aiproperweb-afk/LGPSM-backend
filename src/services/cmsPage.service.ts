import mongoose from 'mongoose';
import { Media, MediaPurpose } from '../models/Media';
import { Page, PageStatus } from '../models/Page';
import { cmsPageRepository } from '../repositories/cmsPage.repository';
import { supportsPageContract, supportedCmsSlugs, validateCmsSeedInput, validatePuckData, withoutRetiredCmsSections } from '../validators/cmsPage.validator';
import { mediaService } from './media.service';

function cmsError(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
  return { statusCode, code, message, ...extra };
}

function requirePageId(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw cmsError(400, 'INVALID_PAGE_ID', 'Invalid page id');
}

function requireExpectedVersion(expectedVersion: number) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw cmsError(400, 'IF_MATCH_INVALID', 'If-Match must contain the editVersion returned by the page API.');
  }
}

async function requirePage(id: string) {
  requirePageId(id);
  const page = await cmsPageRepository.findById(id);
  if (!page || !supportsPageContract(page.slug, page.route, page.schemaVersion)) throw cmsError(404, 'PAGE_NOT_FOUND', 'Page not found');
  return page;
}

async function requireEditablePage(id: string, expectedVersion: number) {
  requireExpectedVersion(expectedVersion);
  const page = await requirePage(id);
  if (page.editVersion !== expectedVersion) throw editConflict(page.editVersion);
  return page;
}

function editConflict(currentVersion: number) {
  return cmsError(409, 'CMS_EDIT_CONFLICT', 'This page changed since you opened it. Reload before saving.', { currentVersion });
}

async function verifyMediaReferences(mediaIds: string[]) {
  if (mediaIds.length === 0) return;
  const approved = await Media.find({ _id: { $in: mediaIds }, purpose: MediaPurpose.CMS_PAGE }).select('storage fileName').lean();
  const approvedIds = new Set<string>();
  for (const media of approved) {
    const id = String(media._id);
    if (await mediaService.hasCmsImage(id, media.storage, media.fileName)) approvedIds.add(id);
  }
  const missing = mediaIds.filter((id) => !approvedIds.has(id));
  if (missing.length) {
    throw cmsError(400, 'CMS_MEDIA_INVALID', 'One or more image references are missing or are not approved for CMS pages.', { invalidMediaIds: missing });
  }
}

function validateStructure(page: { componentStructureLocked: boolean; draftData: unknown; slug: string }, structure: string) {
  if (!page.componentStructureLocked) return;
  const current = validatePuckData(withoutRetiredCmsSections(page.draftData, page.slug), page.slug).structure;
  if (current !== structure) {
    throw cmsError(409, 'CMS_STRUCTURE_LOCKED', 'This page has a fixed component structure; component insertion, deletion and reordering are not allowed.');
  }
}

async function validateContent(data: unknown, slug: string) {
  const validated = validatePuckData(data, slug);
  await verifyMediaReferences(validated.mediaIds);
  return validated;
}

export const cmsPageService = {
  async listPages() {
    return cmsPageRepository.list();
  },

  async getPage(id: string) {
    const page = await requirePage(id);
    return page;
  },

  async saveDraft(id: string, expectedVersion: number, data: unknown, actorId: string) {
    const page = await requireEditablePage(id, expectedVersion);
    const validated = await validateContent(data, page.slug);
    validateStructure(page, validated.structure);
    const updated = await cmsPageRepository.saveDraft(id, expectedVersion, validated.data, actorId);
    if (updated) return updated;
    return this.throwEditConflict(id);
  },

  async publish(id: string, expectedVersion: number, data: unknown, actorId: string) {
    const page = await requireEditablePage(id, expectedVersion);
    const validated = await validateContent(data, page.slug);
    if ((validated.data.content as unknown[]).length === 0) {
      throw cmsError(400, 'CMS_CONTENT_EMPTY', 'A page must contain content before it can be published.');
    }
    validateStructure(page, validated.structure);
    const updated = await cmsPageRepository.publish(id, expectedVersion, validated.data, actorId, new Date());
    if (updated) return updated;
    return this.throwEditConflict(id);
  },

  async discardDraft(id: string, expectedVersion: number, actorId: string) {
    const page = await requireEditablePage(id, expectedVersion);
    if (!page.publishedData) throw cmsError(409, 'PAGE_NOT_PUBLISHED', 'This page has no published snapshot to restore.');
    const updated = await cmsPageRepository.discardDraft(id, expectedVersion, actorId, page.publishedData);
    if (updated) return updated;
    return this.throwEditConflict(id);
  },

  async getPublishedPage(slug: string) {
    if (!supportedCmsSlugs.includes(slug)) throw cmsError(404, 'PAGE_NOT_FOUND', 'Published page not found');
    const page = await cmsPageRepository.findPublishedBySlug(slug);
    if (!page) throw cmsError(404, 'PAGE_NOT_FOUND', 'Published page not found');
    return page;
  },

  async seedPages(input: unknown[]) {
    if (!Array.isArray(input) || input.length === 0) {
      throw cmsError(400, 'CMS_SEED_EMPTY', 'Provide at least one populated page in the CMS seed file.');
    }
    const seeds = input.map(validateCmsSeedInput);
    const slugs = new Set<string>();
    const routes = new Set<string>();
    for (const seed of seeds) {
      if (slugs.has(seed.slug) || routes.has(seed.route)) throw cmsError(400, 'CMS_SEED_DUPLICATE', 'CMS seed pages must have unique slugs and routes.');
      slugs.add(seed.slug);
      routes.add(seed.route);
      await verifyMediaReferences(seed.mediaIds);
    }

    const seededAt = new Date();
    const results = [];
    for (const seed of seeds) {
      const result = await cmsPageRepository.seedOnInsert({
        name: seed.name,
        slug: seed.slug,
        route: seed.route,
        draftData: seed.data,
        publishedData: seed.data,
        status: PageStatus.PUBLISHED,
        schemaVersion: seed.schemaVersion,
        version: 1,
        editVersion: 0,
        componentStructureLocked: seed.componentStructureLocked,
        publishedAt: seededAt
      });
      results.push({ slug: seed.slug, inserted: result.upsertedCount === 1 });
    }
    return results;
  },

  async throwEditConflict(id: string): Promise<never> {
    const current = await Page.findById(id).select('editVersion').lean();
    if (!current) throw cmsError(404, 'PAGE_NOT_FOUND', 'Page not found');
    throw editConflict(current.editVersion);
  }
};
