import { Schema, model } from 'mongoose';
import { IArbitrageOpportunity } from './arbitrage.types';

const ArbitrageSchema = new Schema<IArbitrageOpportunity>({
    type: { type: String, required: true }, // direct or triangular
    exchanges: [{ type: String, required: true }],
    tokenPath: [{ type: String, required: true }],  
    profitPercent: { type: Number, required: true },
    slippage: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});

export const ArbitrageOpportunity = model<IArbitrageOpportunity>('ArbitrageOpportunity', ArbitrageSchema);

