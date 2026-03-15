import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IUploadRawSheet extends Document {
  _id: mongoose.Types.ObjectId;
  uploadId: mongoose.Types.ObjectId;
  sheetName: string;
  headers: string[];
  data: unknown[][];
  rowCount: number;
  createdAt: Date;
}

const UploadRawSheetSchema = new Schema<IUploadRawSheet>({
  uploadId:  { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
  sheetName: { type: String, required: true },
  headers:   { type: [String], default: [] },
  data:      { type: [[Schema.Types.Mixed]], default: [] },
  rowCount:  { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

UploadRawSheetSchema.index({ uploadId: 1, sheetName: 1 }, { unique: true });

export const UploadRawSheet: Model<IUploadRawSheet> =
  mongoose.models.UploadRawSheet ||
  mongoose.model<IUploadRawSheet>('UploadRawSheet', UploadRawSheetSchema);
