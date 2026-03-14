import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUpload extends Document {
  _id: mongoose.Types.ObjectId;
  fileName: string;
  uploadedAt: Date;
  month: string;          // e.g. "Jan 2026" — the reporting month of the file
  status: 'processing' | 'complete' | 'error';
  errorMessage?: string;
  sheetsDetected: string[];
}

const UploadSchema = new Schema<IUpload>({
  fileName:       { type: String, required: true },
  uploadedAt:     { type: Date, default: Date.now },
  month:          { type: String, required: true },
  status:         { type: String, enum: ['processing', 'complete', 'error'], default: 'processing' },
  errorMessage:   { type: String },
  sheetsDetected: { type: [String], default: [] },
});

export const Upload: Model<IUpload> =
  mongoose.models.Upload || mongoose.model<IUpload>('Upload', UploadSchema);
