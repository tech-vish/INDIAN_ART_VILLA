import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IStatewiseData extends Document {
  uploadId: mongoose.Types.ObjectId;
  rows: Array<{
    state: string;
    grossSales: number;
    cancellations: number;
    returns: number;
    netSales: number;
    expenseAllocation: number;
    netEarnings: number;
  }>;
}

const StatewiseDataSchema = new Schema<IStatewiseData>({
  uploadId: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
  rows:     { type: Schema.Types.Mixed, required: true },
});

export const StatewiseData: Model<IStatewiseData> =
  mongoose.models.StatewiseData || mongoose.model<IStatewiseData>('StatewiseData', StatewiseDataSchema);
