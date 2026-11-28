"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsPageService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Media_1 = require("../models/Media");
const Page_1 = require("../models/Page");
const cmsPage_repository_1 = require("../repositories/cmsPage.repository");
const cmsPage_validator_1 = require("../validators/cmsPage.validator");
const media_service_1 = require("./media.service");
function cmsError(statusCode, code, message, extra) {
    return { statusCode, code, message, ...extra };
}
function requirePageId(id) {
    if (!mongoose_1.default.Types.ObjectId.isValid(id))
        throw cmsError(400, 'INVALID_PAGE_ID', 'Invalid page id');
}
function requireExpectedVersion(expectedVersion) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        throw cmsError(400, 'IF_MATCH_INVALID', 'If-Match must contain the editVersion returned by the page API.');
    }
}
async function requirePage(id) {
    requirePageId(id);
    const page = await cmsPage_repository_1.cmsPageRepository.findById(id);
    if (!page)
        throw cmsError(404, 'PAGE_NOT_FOUND', 'Page not found');
    return page;
}
async function requireEditablePage(id, expectedVersion) {
    requireExpectedVersion(expectedVersion);
    const page = await requirePage(id);
    if (!(0, cmsPage_validator_1.supportsPageContract)(page.slug, page.route, page.schemaVersion)) {
        throw cmsError(409, 'CMS_SCHEMA_UNSUPPORTED', 'This page does not use a supported CMS contract.');
    }
    if (page.editVersion !== expectedVersion)
        throw editConflict(page.editVersion);
    return page;
}
function editConflict(currentVersion) {
    return cmsError(409, 'CMS_EDIT_CONFLICT', 'This page changed since you opened it. Reload before saving.', { currentVersion });
}
async function verifyMediaReferences(mediaIds) {
    if (mediaIds.length === 0)
        return;
    const approved = await Media_1.Media.find({ _id: { $in: mediaIds }, purpose: Media_1.MediaPurpose.CMS_PAGE }).select('storage fileName').lean();
    const approvedIds = new Set();
    for (const media of approved) {
        const id = String(media._id);
        if (await media_service_1.mediaService.hasCmsImage(id, media.storage, media.fileName))
            approvedIds.add(id);
    }
    const missing = mediaIds.filter((id) => !approvedIds.has(id));
    if (missing.length) {
        throw cmsError(400, 'CMS_MEDIA_INVALID', 'One or more image references are missing or are not approved for CMS pages.', { invalidMediaIds: missing });
    }
}
function validateStructure(page, structure) {
    if (!page.componentStructureLocked)
        return;
    const current = (0, cmsPage_validator_1.validatePuckData)(page.draftData, page.slug).structure;
    if (current !== structure) {
        throw cmsError(409, 'CMS_STRUCTURE_LOCKED', 'This page has a fixed component structure; component insertion, deletion and reordering are not allowed.');
    }
}
async function validateContent(data, slug) {
    const validated = (0, cmsPage_validator_1.validatePuckData)(data, slug);
    await verifyMediaReferences(validated.mediaIds);
    return validated;
}
exports.cmsPageService = {
    async listPages() {
        return cmsPage_repository_1.cmsPageRepository.list();
    },
    async getPage(id) {
        const page = await requirePage(id);
        return page;
    },
    async saveDraft(id, expectedVersion, data, actorId) {
        const page = await requireEditablePage(id, expectedVersion);
        const validated = await validateContent(data, page.slug);
        validateStructure(page, validated.structure);
        const updated = await cmsPage_repository_1.cmsPageRepository.saveDraft(id, expectedVersion, validated.data, actorId);
        if (updated)
            return updated;
        return this.throwEditConflict(id);
    },
    async publish(id, expectedVersion, data, actorId) {
        const page = await requireEditablePage(id, expectedVersion);
        const validated = await validateContent(data, page.slug);
        if (validated.data.content.length === 0) {
            throw cmsError(400, 'CMS_CONTENT_EMPTY', 'A page must contain content before it can be published.');
        }
        validateStructure(page, validated.structure);
        const updated = await cmsPage_repository_1.cmsPageRepository.publish(id, expectedVersion, validated.data, actorId, new Date());
        if (updated)
            return updated;
        return this.throwEditConflict(id);
    },
    async discardDraft(id, expectedVersion, actorId) {
        const page = await requireEditablePage(id, expectedVersion);
        if (!page.publishedData)
            throw cmsError(409, 'PAGE_NOT_PUBLISHED', 'This page has no published snapshot to restore.');
        const updated = await cmsPage_repository_1.cmsPageRepository.discardDraft(id, expectedVersion, actorId, page.publishedData);
        if (updated)
            return updated;
        return this.throwEditConflict(id);
    },
    async getPublishedPage(slug) {
        const page = await cmsPage_repository_1.cmsPageRepository.findPublishedBySlug(slug);
        if (!page)
            throw cmsError(404, 'PAGE_NOT_FOUND', 'Published page not found');
        return page;
    },
    async seedPages(input) {
        if (!Array.isArray(input) || input.length === 0) {
            throw cmsError(400, 'CMS_SEED_EMPTY', 'Provide at least one populated page in the CMS seed file.');
        }
        const seeds = input.map(cmsPage_validator_1.validateCmsSeedInput);
        const slugs = new Set();
        const routes = new Set();
        for (const seed of seeds) {
            if (slugs.has(seed.slug) || routes.has(seed.route))
                throw cmsError(400, 'CMS_SEED_DUPLICATE', 'CMS seed pages must have unique slugs and routes.');
            slugs.add(seed.slug);
            routes.add(seed.route);
            await verifyMediaReferences(seed.mediaIds);
        }
        const seededAt = new Date();
        const results = [];
        for (const seed of seeds) {
            const result = await cmsPage_repository_1.cmsPageRepository.seedOnInsert({
                name: seed.name,
                slug: seed.slug,
                route: seed.route,
                draftData: seed.data,
                publishedData: seed.data,
                status: Page_1.PageStatus.PUBLISHED,
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
    async throwEditConflict(id) {
        const current = await Page_1.Page.findById(id).select('editVersion').lean();
        if (!current)
            throw cmsError(404, 'PAGE_NOT_FOUND', 'Page not found');
        throw editConflict(current.editVersion);
    }
};
