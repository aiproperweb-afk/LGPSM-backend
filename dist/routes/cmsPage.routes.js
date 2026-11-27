"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsWorkspacePageRoutes = exports.cmsPublicPageRoutes = exports.cmsAdminPageRoutes = void 0;
const express_1 = require("express");
const cmsPage_controller_1 = require("../controllers/cmsPage.controller");
const authenticate_1 = require("../middlewares/authenticate");
const authorizeRoles_1 = require("../middlewares/authorizeRoles");
const auditAction_1 = require("../middlewares/auditAction");
const User_1 = require("../models/User");
const cmsPage_validator_1 = require("../validators/cmsPage.validator");
const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ success: false, code: 'CMS_REQUEST_INVALID', message: result.error.issues[0]?.message || 'Invalid request body' });
    }
    req.body = result.data;
    next();
};
const validatePageId = (req, res, next) => {
    if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
        return res.status(400).json({ success: false, code: 'INVALID_PAGE_ID', message: 'Invalid page id' });
    }
    next();
};
exports.cmsAdminPageRoutes = (0, express_1.Router)();
exports.cmsAdminPageRoutes.use(authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ADMIN));
exports.cmsAdminPageRoutes.get('/', cmsPage_controller_1.cmsPageController.listPages);
exports.cmsAdminPageRoutes.get('/:id', validatePageId, cmsPage_controller_1.cmsPageController.getPage);
exports.cmsAdminPageRoutes.patch('/:id/draft', validatePageId, validate(cmsPage_validator_1.cmsDraftBodySchema), (0, auditAction_1.auditAction)({ action: 'CMS_PAGE_DRAFT_SAVE', entityType: 'Page', entityParam: 'id' }), cmsPage_controller_1.cmsPageController.saveDraft);
exports.cmsAdminPageRoutes.post('/:id/publish', validatePageId, validate(cmsPage_validator_1.cmsPublishBodySchema), (0, auditAction_1.auditAction)({ action: 'CMS_PAGE_PUBLISH', entityType: 'Page', entityParam: 'id', critical: true, describe: 'CMS page published' }), cmsPage_controller_1.cmsPageController.publish);
exports.cmsAdminPageRoutes.post('/:id/discard-draft', validatePageId, (0, auditAction_1.auditAction)({ action: 'CMS_PAGE_DRAFT_DISCARD', entityType: 'Page', entityParam: 'id' }), cmsPage_controller_1.cmsPageController.discardDraft);
const editConflictResponse = (error, _req, res, next) => {
    if (error?.code !== 'CMS_EDIT_CONFLICT')
        return next(error);
    res.status(409).json({ success: false, code: error.code, message: error.message, currentVersion: error.currentVersion });
};
exports.cmsAdminPageRoutes.use(editConflictResponse);
exports.cmsPublicPageRoutes = (0, express_1.Router)();
exports.cmsPublicPageRoutes.get('/:slug', cmsPage_controller_1.cmsPageController.getPublishedPage);
exports.cmsWorkspacePageRoutes = (0, express_1.Router)();
exports.cmsWorkspacePageRoutes.use(authenticate_1.authenticate, (0, authorizeRoles_1.authorizeRoles)(User_1.Role.ADMIN, User_1.Role.ORGANIZER));
exports.cmsWorkspacePageRoutes.get('/:slug', cmsPage_controller_1.cmsPageController.getWorkspacePage);
