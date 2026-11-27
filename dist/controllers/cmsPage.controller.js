"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsPageController = void 0;
const cmsPage_service_1 = require("../services/cmsPage.service");
const cmsPage_validator_1 = require("../validators/cmsPage.validator");
function pageResponse(page) {
    const data = page.toJSON();
    return {
        ...data,
        draftData: (0, cmsPage_validator_1.withoutRetiredCmsSections)(data.draftData, data.slug),
        publishedData: (0, cmsPage_validator_1.withoutRetiredCmsSections)(data.publishedData, data.slug)
    };
}
function editVersion(req) {
    const value = req.header('If-Match');
    if (value === undefined)
        throw { statusCode: 428, code: 'IF_MATCH_REQUIRED', message: 'Send If-Match with the editVersion returned by the page API.' };
    const match = /^(?:"(\d+)"|(\d+))$/.exec(value.trim());
    if (!match)
        throw { statusCode: 400, code: 'IF_MATCH_INVALID', message: 'If-Match must contain the editVersion returned by the page API.' };
    const version = Number(match[1] ?? match[2]);
    if (!Number.isSafeInteger(version))
        throw { statusCode: 400, code: 'IF_MATCH_INVALID', message: 'If-Match must contain a valid editVersion.' };
    return version;
}
exports.cmsPageController = {
    async listPages(_req, res, next) {
        try {
            return res.status(200).json({ success: true, data: await cmsPage_service_1.cmsPageService.listPages() });
        }
        catch (error) {
            return next(error);
        }
    },
    async getPage(req, res, next) {
        try {
            return res.status(200).json({ success: true, data: pageResponse(await cmsPage_service_1.cmsPageService.getPage(req.params.id)) });
        }
        catch (error) {
            return next(error);
        }
    },
    async saveDraft(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.saveDraft(req.params.id, editVersion(req), req.body.data, req.user.userId);
            return res.status(200).json({ success: true, data: pageResponse(data) });
        }
        catch (error) {
            return next(error);
        }
    },
    async publish(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.publish(req.params.id, editVersion(req), req.body.data, req.user.userId);
            return res.status(200).json({ success: true, data: pageResponse(data) });
        }
        catch (error) {
            return next(error);
        }
    },
    async discardDraft(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.discardDraft(req.params.id, editVersion(req), req.user.userId);
            return res.status(200).json({ success: true, data: pageResponse(data) });
        }
        catch (error) {
            return next(error);
        }
    },
    getPublishedPage: publishedPage(false),
    getWorkspacePage: publishedPage(true)
};
function publishedPage(workspace) {
    return async (req, res, next) => {
        try {
            res.set('Cache-Control', 'no-store');
            const page = await cmsPage_service_1.cmsPageService.getPublishedPage(req.params.slug, workspace ? req.user.role : undefined);
            return res.status(200).json({
                success: true,
                data: {
                    name: page.name,
                    slug: page.slug,
                    route: page.route,
                    status: 'PUBLISHED',
                    schemaVersion: page.schemaVersion,
                    version: page.version,
                    publishedAt: page.publishedAt,
                    content: (0, cmsPage_validator_1.withoutRetiredCmsSections)(page.publishedData, page.slug)
                }
            });
        }
        catch (error) {
            return next(error);
        }
    };
}
