import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUploadedFile {
  fileType: string;
  fileName: string;
  uploadedAt: Date;
  sheetsFound: string[];
  fileId: mongoose.Types.ObjectId;
}

export interface IOpeningStock {
  tradedGoods: number;
  packingMaterial: number;
}

export interface IMonthlyPeriod extends Document {
  _id: mongoose.Types.ObjectId;
  month: string;              // "Jan 2026", "Feb 2026", etc.
  year: number;               // 2026
  monthIndex: number;         // 0=Jan, 1=Feb, ... 11=Dec (for sorting)
  fiscalYear: string;         // "2025-26"
  fiscalQuarter: string;      // "Q1" | "Q2" | "Q3" | "Q4"
  status: 'draft' | 'processing' | 'complete' | 'error';

  // Track which raw files have been uploaded for this month
  uploadedFiles: IUploadedFile[];

  // Assembled sheet state
  availableSheets: string[];  // sheets currently available across all uploaded files
  missingSheets: string[];    // sheets still needed before processing

  // References to computed results
  uploadId: mongoose.Types.ObjectId | null;    // ref: Upload (backward compat)
  plResultId: mongoose.Types.ObjectId | null;  // ref: PLResult

  // Carry-forward data from previous month
  previousMonthId: mongoose.Types.ObjectId | null;  // ref: MonthlyPeriod
  openingStock: IOpeningStock;

  createdAt: Date;
  updatedAt: Date;
}

const UploadedFileSchema = new Schema<IUploadedFile>(
  {
    fileType:    { type: String, required: true },
    fileName:    { type: String, required: true },
    uploadedAt:  { type: Date, default: Date.now },
    sheetsFound: { type: [String], default: [] },
    fileId:      { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const OpeningStockSchema = new Schema<IOpeningStock>(
  {
    tradedGoods:     { type: Number, default: 0 },
    packingMaterial: { type: Number, default: 0 },
  },
  { _id: false },
);

const MonthlyPeriodSchema = new Schema<IMonthlyPeriod>(
  {
    month:        { type: String, required: true },
    year:         { type: Number, required: true },
    monthIndex:   { type: Number, required: true, min: 0, max: 11 },
    fiscalYear:   { type: String, required: true },
    fiscalQuarter: { type: String, required: true, enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
    status:       { type: String, enum: ['draft', 'processing', 'complete', 'error'], default: 'draft' },

    uploadedFiles:  { type: [UploadedFileSchema], default: [] },
    availableSheets: { type: [String], default: [] },
    missingSheets:  { type: [String], default: [] },

    uploadId:        { type: Schema.Types.ObjectId, ref: 'Upload', default: null },
    plResultId:      { type: Schema.Types.ObjectId, ref: 'PLResult', default: null },
    previousMonthId: { type: Schema.Types.ObjectId, ref: 'MonthlyPeriod', default: null },

    openingStock: { type: OpeningStockSchema, default: () => ({ tradedGoods: 0, packingMaterial: 0 }) },
  },
  { timestamps: true },
);

// Unique index: one period per month label
MonthlyPeriodSchema.index({ month: 1 }, { unique: true });
// Compound index for fiscal year queries
MonthlyPeriodSchema.index({ fiscalYear: 1, monthIndex: 1 });

export const MonthlyPeriod: Model<IMonthlyPeriod> =
  mongoose.models.MonthlyPeriod ||
  mongoose.model<IMonthlyPeriod>('MonthlyPeriod', MonthlyPeriodSchema);
