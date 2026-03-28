import { Document } from 'mongoose';
export interface IArbitrageOpportunity extends Document {
    type: string;
    exchanges: string[];
    tokenPath: string[];
    profitPercent: number;
    slippage: number;
    createdAt: Date;
}   