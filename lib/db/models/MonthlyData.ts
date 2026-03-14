import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMonthlyData extends Document {
  uploadId: mongoose.Types.ObjectId;
  rows: Array<{
    month: string;        // formatted: "Apr-24", "Jan-26"
    grossSales: number;
    cancellations: number;
    courierReturns: number;
    customerReturns: number;
    shippingReceived: number;
    netSales: number;
    amazonCommission: number;
    amazonAds: number;
    fulfilmentFees: number;
    otherFees: number;
    totalExpenses: number;
    netEarnings: number;
  }>;
}

const MonthlyDataSchema = new Schema<IMonthlyData>({
  uploadId: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
  rows:     { type: Schema.Types.Mixed, required: true },
});

export const MonthlyData: Model<IMonthlyData> =
  mongoose.models.MonthlyData || mongoose.model<IMonthlyData>('MonthlyData', MonthlyDataSchema);
