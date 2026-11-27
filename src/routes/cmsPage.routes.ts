import { Router, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { cmsPageController } from '../controllers/cmsPage.controller';
import { authenticate } from '../middlewares/authenticate';
import { authorizeRoles } from '../middlewares/authorizeRoles';
import { auditAction } from '../middlewares/auditAction';
import { Role } from '../models/User';
import { cmsDraftBodySchema, cmsPublishBodySchema } from '../validators/cmsPage.validator';

const validate = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ success: false, code: 'CMS_REQUEST_INVALID', message: result.error.issues[0]?.message || 'Invalid request body' });
  }
  req.body = result.data;
  next();
};

const validatePageId = (req: Request, res: Response, next: NextFunction) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
    return res.status(400).json({ success: false, code: 'INVALID_PAGE_ID', message: 'Invalid page id' });
  }
  next();
};

export const cmsAdminPageRoutes = Router();
cmsAdminPageRoutes.use(authenticate, authorizeRoles(Role.ADMIN));
cmsAdminPageRoutes.get('/', cmsPageController.listPages);
cmsAdminPageRoutes.get('/:id', validatePageId, cmsPageController.getPage);
cmsAdminPageRoutes.patch('/:id/draft', validatePageId, validate(cmsDraftBodySchema), auditAction({ action: 'CMS_PAGE_DRAFT_SAVE', entityType: 'Page', entityParam: 'id' }), cmsPageController.saveDraft);
cmsAdminPageRoutes.post('/:id/publish', validatePageId, validate(cmsPublishBodySchema), auditAction({ action: 'CMS_PAGE_PUBLISH', entityType: 'Page', entityParam: 'id', critical: true, describe: 'CMS page published' }), cmsPageController.publish);
cmsAdminPageRoutes.post('/:id/discard-draft', validatePageId, auditAction({ action: 'CMS_PAGE_DRAFT_DISCARD', entityType: 'Page', entityParam: 'id' }), cmsPageController.discardDraft);
const editConflictResponse: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.code !== 'CMS_EDIT_CONFLICT') return next(error);
  res.status(409).json({ success: false, code: error.code, message: error.message, currentVersion: error.currentVersion });
};
cmsAdminPageRoutes.use(editConflictResponse);

export const cmsPublicPageRoutes = Router();
cmsPublicPageRoutes.get('/:slug', cmsPageController.getPublishedPage);

export const cmsWorkspacePageRoutes = Router();
cmsWorkspacePageRoutes.use(authenticate, authorizeRoles(Role.ADMIN, Role.ORGANIZER));
cmsWorkspacePageRoutes.get('/:slug', cmsPageController.getWorkspacePage);
