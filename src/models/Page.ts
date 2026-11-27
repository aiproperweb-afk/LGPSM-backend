import mongoose, { Document, Schema } from 'mongoose';

export enum PageStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED'
}

export interface IPage extends Document {
  name: string;
  slug: string;
  route: string;
  draftData: Record<string, any>;
  publishedData?: Record<string, any>;
  status: PageStatus;
  schemaVersion: number;
  version: number;
  editVersion: number;
  componentStructureLocked: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  publishedBy?: mongoose.Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PageSchema = new Schema<IPage>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    route: { type: String, required: true, trim: true },
    draftData: { type: Schema.Types.Mixed, required: true },
    publishedData: { type: Schema.Types.Mixed },
    status: { type: String, enum: Object.values(PageStatus), default: PageStatus.DRAFT, required: true },
    schemaVersion: { type: Number, required: true, min: 1 },
    version: { type: Number, default: 0, min: 0 },
    editVersion: { type: Number, default: 0, min: 0 },
    componentStructureLocked: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date }
  },
  { timestamps: true, minimize: false }
);

PageSchema.index({ slug: 1 }, { unique: true, name: 'uniq_page_slug' });
PageSchema.index({ route: 1 }, { unique: true, name: 'uniq_page_route' });
PageSchema.index({ status: 1, updatedAt: -1 });

export const Page = mongoose.model<IPage>('Page', PageSchema);
