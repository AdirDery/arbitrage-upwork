import { Schema, model, Document } from 'mongoose';

export interface IExchange extends Document {
    name: string;
    apiKey: string;
    apiSecret: string;
    enabled: boolean;
    lastConnected: Date;
}

const ExchangeSchema = new Schema<IExchange>({
    name: { type: String, required: true, unique: true },
    apiKey: { type: String, required: true },
    apiSecret: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    lastConnected: { type: Date }
});

export const Exchange = model<IExchange>('Exchange', ExchangeSchema);
