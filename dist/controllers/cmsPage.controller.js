"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsPageController = void 0;
const cmsPage_service_1 = require("../services/cmsPage.service");
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
            return res.status(200).json({ success: true, data: await cmsPage_service_1.cmsPageService.getPage(req.params.id) });
        }
        catch (error) {
            return next(error);
        }
    },
    async saveDraft(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.saveDraft(req.params.id, editVersion(req), req.body.data, req.user.userId);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return next(error);
        }
    },
    async publish(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.publish(req.params.id, editVersion(req), req.body.data, req.user.userId);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return next(error);
        }
    },
    async discardDraft(req, res, next) {
        try {
            const data = await cmsPage_service_1.cmsPageService.discardDraft(req.params.id, editVersion(req), req.user.userId);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return next(error);
        }
    },
    async getPublishedPage(req, res, next) {
        try {
            res.set('Cache-Control', 'no-store');
            const page = await cmsPage_service_1.cmsPageService.getPublishedPage(req.params.slug);
            if (page.slug === 'contact')
                res.set('X-Contact-CMS-Schema', '2');
            if (page.slug === 'home')
                res.set('X-Visual-CMS-Schema', '2');
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
                    content: page.publishedData
                }
            });
        }
        catch (error) {
            return next(error);
        }
    }
};
