import { Request, Response, NextFunction } from 'express';
import { cmsPageService } from '../services/cmsPage.service';

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
      return res.status(200).json({ success: true, data: await cmsPageService.getPage(req.params.id as string) });
    } catch (error) {
      return next(error);
    }
  },

  async saveDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.saveDraft(req.params.id as string, editVersion(req), req.body.data, req.user!.userId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },

  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.publish(req.params.id as string, editVersion(req), req.body.data, req.user!.userId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },

  async discardDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await cmsPageService.discardDraft(req.params.id as string, editVersion(req), req.user!.userId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },

  async getPublishedPage(req: Request, res: Response, next: NextFunction) {
    try {
      res.set('Cache-Control', 'no-store');
      const page = await cmsPageService.getPublishedPage(req.params.slug as string);
      if (page.slug === 'contact') res.set('X-Contact-CMS-Schema', '2');
      if (page.slug === 'home') res.set({ 'X-Visual-CMS-Schema': '2', 'X-Visual-CMS-Elements': 'element-inspector' });
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
    } catch (error) {
      return next(error);
    }
  }
};
