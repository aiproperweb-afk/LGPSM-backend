"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsPageRepository = void 0;
const Page_1 = require("../models/Page");
const cmsPage_validator_1 = require("../validators/cmsPage.validator");
exports.cmsPageRepository = {
    async list() {
        return Page_1.Page.find({ slug: { $in: cmsPage_validator_1.editableCmsSlugs } })
            .select('name slug route status schemaVersion version editVersion componentStructureLocked updatedBy publishedBy publishedAt createdAt updatedAt')
            .populate('updatedBy', 'fullName email')
            .populate('publishedBy', 'fullName email')
            .sort({ name: 1 })
            .lean();
    },
    async findById(id) {
        return Page_1.Page.findById(id);
    },
    async findPublishedBySlug(slug) {
        return Page_1.Page.findOne({
            slug,
            publishedAt: { $ne: null },
            publishedData: { $exists: true, $ne: null }
        })
            .select('name slug route schemaVersion version publishedData publishedAt updatedAt')
            .lean();
    },
    async saveDraft(id, expectedVersion, data, actorId) {
        return Page_1.Page.findOneAndUpdate({ _id: id, editVersion: expectedVersion }, { $set: { draftData: data, status: Page_1.PageStatus.DRAFT, updatedBy: actorId }, $inc: { editVersion: 1 } }, { new: true, runValidators: true });
    },
    async publish(id, expectedVersion, data, actorId, publishedAt) {
        return Page_1.Page.findOneAndUpdate({ _id: id, editVersion: expectedVersion }, {
            $set: {
                draftData: data,
                publishedData: data,
                status: Page_1.PageStatus.PUBLISHED,
                updatedBy: actorId,
                publishedBy: actorId,
                publishedAt
            },
            $inc: { version: 1, editVersion: 1 }
        }, { new: true, runValidators: true });
    },
    async discardDraft(id, expectedVersion, actorId, publishedData) {
        return Page_1.Page.findOneAndUpdate({ _id: id, editVersion: expectedVersion, publishedData: { $exists: true, $ne: null } }, { $set: { draftData: publishedData, status: Page_1.PageStatus.PUBLISHED, updatedBy: actorId }, $inc: { editVersion: 1 } }, { new: true, runValidators: true });
    },
    async seedOnInsert(page) {
        const now = new Date();
        return Page_1.Page.updateOne({ slug: page.slug }, { $setOnInsert: { ...page, createdAt: now, updatedAt: now } }, { upsert: true, setDefaultsOnInsert: true, runValidators: true, timestamps: false });
    }
};
