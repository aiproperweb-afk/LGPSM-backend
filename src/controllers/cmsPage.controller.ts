import { Request, Response, NextFunction } from 'express';
import { cmsPageService } from '../services/cmsPage.service';
import { withoutRetiredCmsSections } from '../validators/cmsPage.validator';

function pageResponse(page: Awaited<ReturnType<typeof cmsPageService.getPage>>) {
  const data = page.toJSON();
  return {
    ...data,
    draftData: withoutRetiredCmsSections(data.draftData, data.slug),
    publishedData: withoutRetiredCmsSections(data.publishedData, data.slug)
  };
}

function editVersion(req: Request): number {
  const value = req.header('If-Match');
  if (value === undefined) throw { statusCode: 428, code: 'IF_MATCH_REQUIRED', message: 'Send If-Match with the editVersion returned by the page API.' };
  const match = /^(?:"(\d+)"|(\d+))$/.exec(value.trim());
  if (!match) throw { statusCode: 400, code: 'IF_MATCH_INVALID', message: 'If-Match must contain the editVersion returned by the page API.' };
  const version = Number(match[1] ?? match[2]);
  if (!Number.isSafeInteger(version)) throw { statusCode: 400, code: 'IF_MATCH_INVALID', message: 'If-Match must contain a valid editVersion.' };
  return version;
}

export const cmsPageController = {
  async listPages(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json({ success: true, data: await cmsPageService.listPages() });
    } catch (error) {
      return next(error);
    }
  },

  async getPage(req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json({ success: true, data: pageResponse(await cmsPageService.getPage(req.params.id as string)) });
    } catch (error) {
      return next(error);
    }
  },

  async saveDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.saveDraft(req.params.id as string, editVersion(req), req.body.data, req.user!.userId);
      return res.status(200).json({ success: true, data: pageResponse(data) });
    } catch (error) {
      return next(error);
    }
  },

  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.publish(req.params.id as string, editVersion(req), req.body.data, req.user!.userId);
      return res.status(200).json({ success: true, data: pageResponse(data) });
    } catch (error) {
      return next(error);
    }
  },

  async discardDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.discardDraft(req.params.id as string, editVersion(req), req.user!.userId);
      return res.status(200).json({ success: true, data: pageResponse(data) });
    } catch (error) {
      return next(error);
    }
  },

  getPublishedPage: publishedPage(false),
  getWorkspacePage: publishedPage(true)
};

function publishedPage(workspace: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      const page = await cmsPageService.getPublishedPage(req.params.slug as string, workspace ? req.user!.role : undefined);
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
          content: withoutRetiredCmsSections(page.publishedData, page.slug)
        }
      });
    } catch (error) {
      return next(error);
    }
  };
}
