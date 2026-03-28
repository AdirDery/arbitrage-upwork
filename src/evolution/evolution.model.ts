import mongoose, { Schema } from "mongoose";

const BrainRecordSchema = new Schema({
  brainId: { type: String, required: true, index: true },
  strategyType: { type: String, required: true },
  chromosome: { type: Schema.Types.Mixed, required: true },
  generation: { type: Number, required: true },
  fitness: { type: Number, default: 0 },
  metrics: { type: Schema.Types.Mixed },
  status: { type: String, enum: ["active", "retired", "graduated"], default: "active" },
  createdAt: { type: Date, default: Date.now },
});

const GenerationRecordSchema = new Schema({
  generation: { type: Number, required: true },
  bestFitness: { type: Number },
  avgFitness: { type: Number },
  bestBrainId: { type: String },
  brainSummaries: { type: Schema.Types.Mixed },
  populationSize: { type: Number },
  timestamp: { type: Date, default: Date.now },
});

const EvolutionConfigSchema = new Schema({
  configId: { type: String, default: "default", unique: true },
  populationSize: { type: Number, default: 10 },
  eliteCount: { type: Number, default: 2 },
  mutationRate: { type: Number, default: 0.2 },
  crossoverRate: { type: Number, default: 0.7 },
  tournamentSize: { type: Number, default: 3 },
  evaluationPeriodHours: { type: Number, default: 24 },
  strategyType: { type: String, default: "direct" },
  isRunning: { type: Boolean, default: false },
});

export const BrainRecord = mongoose.model("BrainRecord", BrainRecordSchema);
export const GenerationRecord = mongoose.model("GenerationRecord", GenerationRecordSchema);
export const EvolutionConfig = mongoose.model("EvolutionConfig", EvolutionConfigSchema);
