import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOrdersData extends Document {
  uploadId: mongoose.Types.ObjectId;
  month: string;
  /** CombinedOrders serialised as a Mixed document */
  data: Record<string, any>;
}

const OrdersDataSchema = new Schema<IOrdersData>({
  uploadId: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
  month:    { type: String, required: true },
  data:     { type: Schema.Types.Mixed, required: true },
});

export const OrdersData: Model<IOrdersData> =
  mongoose.models.OrdersData || mongoose.model<IOrdersData>('OrdersData', OrdersDataSchema);
