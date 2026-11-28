import { Page, IPage, PageStatus } from '../models/Page';
import { PuckData, editableCmsSlugs } from '../validators/cmsPage.validator';

export const cmsPageRepository = {
  async list() {
    return Page.find({ slug: { $in: editableCmsSlugs } })
      .select('name slug route status schemaVersion version editVersion componentStructureLocked updatedBy publishedBy publishedAt createdAt updatedAt')
      .populate('updatedBy', 'fullName email')
      .populate('publishedBy', 'fullName email')
      .sort({ name: 1 })
      .lean();
  },

  async findById(id: string) {
    return Page.findById(id);
  },

  async findPublishedBySlug(slug: string) {
    return Page.findOne({
      slug,
      publishedAt: { $ne: null },
      publishedData: { $exists: true, $ne: null }
    })
      .select('name slug route schemaVersion version publishedData publishedAt updatedAt')
      .lean();
  },

  async saveDraft(id: string, expectedVersion: number, data: PuckData, actorId: string) {
    return Page.findOneAndUpdate(
      { _id: id, editVersion: expectedVersion },
      { $set: { draftData: data, status: PageStatus.DRAFT, updatedBy: actorId }, $inc: { editVersion: 1 } },
      { new: true, runValidators: true }
    );
  },

  async publish(id: string, expectedVersion: number, data: PuckData, actorId: string, publishedAt: Date) {
    return Page.findOneAndUpdate(
      { _id: id, editVersion: expectedVersion },
      {
        $set: {
          draftData: data,
          publishedData: data,
          status: PageStatus.PUBLISHED,
          updatedBy: actorId,
          publishedBy: actorId,
          publishedAt
        },
        $inc: { version: 1, editVersion: 1 }
      },
      { new: true, runValidators: true }
    );
  },

  async discardDraft(id: string, expectedVersion: number, actorId: string, publishedData: Record<string, any>) {
    return Page.findOneAndUpdate(
      { _id: id, editVersion: expectedVersion, publishedData: { $exists: true, $ne: null } },
      { $set: { draftData: publishedData, status: PageStatus.PUBLISHED, updatedBy: actorId }, $inc: { editVersion: 1 } },
      { new: true, runValidators: true }
    );
  },

  async seedOnInsert(page: Partial<IPage>) {
    const now = new Date();
    return Page.updateOne(
      { slug: page.slug },
      { $setOnInsert: { ...page, createdAt: now, updatedAt: now } },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true, timestamps: false }
    );
  }
};
