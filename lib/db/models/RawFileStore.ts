import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISheetData {
  sheetName: string;   // e.g. "AMAZON B2C MAIN SHEET"
  headers: string[];   // column header row
  data: unknown[][];   // 2-D row data (raw cell values)
  rowCount: number;
}

export interface IRawFileStore extends Document {
  _id: mongoose.Types.ObjectId;
  monthlyPeriodId: mongoose.Types.ObjectId;  // which month this file belongs to
  fileType: string;                           // key from FILE_TYPES registry
  fileName: string;                           // original uploaded filename
  sheets: ISheetData[];
  uploadedAt: Date;
}

const SheetDataSchema = new Schema<ISheetData>(
  {
    sheetName: { type: String, required: true },
    headers:   { type: [String], default: [] },
    data:      { type: [[Schema.Types.Mixed]], default: [] },
    rowCount:  { type: Number, default: 0 },
  },
  { _id: false },
);

const RawFileStoreSchema = new Schema<IRawFileStore>({
  monthlyPeriodId: { type: Schema.Types.ObjectId, ref: 'MonthlyPeriod', required: true, index: true },
  fileType:        { type: String, required: true },
  fileName:        { type: String, required: true },
  sheets:          { type: [SheetDataSchema], default: [] },
  uploadedAt:      { type: Date, default: Date.now },
});

// Compound index: look up all files for a given period
RawFileStoreSchema.index({ monthlyPeriodId: 1, fileType: 1 });

export const RawFileStore: Model<IRawFileStore> =
  mongoose.models.RawFileStore ||
  mongoose.model<IRawFileStore>('RawFileStore', RawFileStoreSchema);
