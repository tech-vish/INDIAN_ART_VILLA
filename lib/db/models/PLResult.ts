import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPLResult extends Document {
  _id: mongoose.Types.ObjectId;
  uploadId: mongoose.Types.ObjectId;   // ref → Upload._id
  month: string;
  fiscalQuarter: string;               // 'Q1' | 'Q2' | 'Q3' | 'Q4'
  fiscalYear: string;                  // '2025-26'
  computedAt: Date;
  data: Record<string, any>;           // full PLOutput
  processingErrors: string[];
  intermediates: Record<string, any>;  // IntermediateSheets
  amazonMonthlyRow: Record<string, any>; // AmazonMonthlyPLRow
  comparativePL: any[];                // ComparativePL[]
  quarterlyRollup: Record<string, any>; // QuarterlyRollup
  ordersSheet: Record<string, any>;    // OrdersSheet
  kpiSheet: Record<string, any>;       // KPISheet
  amazonStatewisePL: Record<string, any>; // AmazonStatewisePL
}

const PLResultSchema = new Schema<IPLResult>({
  uploadId:         { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
  month:            { type: String, required: true },
  fiscalQuarter:    { type: String, default: '' },
  fiscalYear:       { type: String, default: '', index: true },
  computedAt:       { type: Date, default: Date.now },
  data:             { type: Schema.Types.Mixed, required: true },
  processingErrors: { type: [String], default: [] },
  intermediates:    { type: Schema.Types.Mixed, default: {} },
  amazonMonthlyRow: { type: Schema.Types.Mixed, default: {} },
  comparativePL:    { type: Schema.Types.Mixed, default: [] },
  quarterlyRollup:  { type: Schema.Types.Mixed, default: {} },
  ordersSheet:      { type: Schema.Types.Mixed, default: {} },
  kpiSheet:         { type: Schema.Types.Mixed, default: {} },
  amazonStatewisePL: { type: Schema.Types.Mixed, default: {} },
});

export const PLResult: Model<IPLResult> =
  mongoose.models.PLResult || mongoose.model<IPLResult>('PLResult', PLResultSchema);
