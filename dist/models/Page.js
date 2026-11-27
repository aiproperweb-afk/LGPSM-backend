"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Page = exports.PageStatus = void 0;
const mongoose_1 = __importStar(require("mongoose"));
var PageStatus;
(function (PageStatus) {
    PageStatus["DRAFT"] = "DRAFT";
    PageStatus["PUBLISHED"] = "PUBLISHED";
})(PageStatus || (exports.PageStatus = PageStatus = {}));
const PageSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    route: { type: String, required: true, trim: true },
    draftData: { type: mongoose_1.Schema.Types.Mixed, required: true },
    publishedData: { type: mongoose_1.Schema.Types.Mixed },
    status: { type: String, enum: Object.values(PageStatus), default: PageStatus.DRAFT, required: true },
    schemaVersion: { type: Number, required: true, min: 1 },
    version: { type: Number, default: 0, min: 0 },
    editVersion: { type: Number, default: 0, min: 0 },
    componentStructureLocked: { type: Boolean, default: false },
    updatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    publishedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date }
}, { timestamps: true, minimize: false });
PageSchema.index({ slug: 1 }, { unique: true, name: 'uniq_page_slug' });
PageSchema.index({ route: 1 }, { unique: true, name: 'uniq_page_route' });
PageSchema.index({ status: 1, updatedAt: -1 });
exports.Page = mongoose_1.default.model('Page', PageSchema);
