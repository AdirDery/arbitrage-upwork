import mongoose, { Schema, model, Document } from 'mongoose';

export interface IConfig extends Document {
    capitalBinance: number;
    capitalBybit:number;
    capitalMexc:number;
    capitalBingX:number; 
    capitalOkx:number;  
    profitThreshold: number;
    slippageTolerance: number;
    directArbSize:number;
    triangularArbSize:number;
}

const ConfigSchema = new Schema<IConfig>({
    capitalBinance: { type: Number, required: true },
    capitalBybit: { type: Number, required: true },
    capitalMexc: { type: Number, required: true },
    capitalBingX: { type: Number, required: true },
    capitalOkx: { type: Number, required: true },
    profitThreshold: { type: Number, default: 0.5 },
    slippageTolerance: { type: Number, default: 0.5 },
    directArbSize:{type:Number, default:0.5},
    triangularArbSize:{type:Number, default:200},
});



const userPrefrencesSchema = new Schema({
    selectedSymbols:{type:[String],default:[]},
    selectedExchanges:{type:[String],default:[]}
})

export const Config = model<IConfig>('Config', ConfigSchema);
export const UserPreferences = mongoose.model("UserPreferences", userPrefrencesSchema);
