import mongoose, { Schema } from "mongoose";

const AdvisorInsightSchema = new Schema({
  category: {
    type: String,
    enum: ["market_pattern", "strategy_performance", "exchange_behavior", "risk_alert", "opportunity", "recommendation"],
    required: true,
  },
  title: { type: String, required: true },
  content: { type: String, required: true },
  confidence: { type: Number, min: 0, max: 1, default: 0.5 },
  source: { type: String },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
});

const PerformanceSnapshotSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  period: { type: String, enum: ["hourly", "daily"], required: true },
  totalTrades: { type: Number, default: 0 },
  totalPnL: { type: Number, default: 0 },
  winRate: { type: Number, default: 0 },
  bestStrategy: { type: String },
  bestExchangePair: { type: String },
  regime: { type: String },
  spreadsAvg: { type: Number },
});

const AdvisorReportSchema = new Schema({
  type: { type: String, enum: ["hourly", "daily", "alert"], required: true },
  content: { type: String, required: true },
  sentAt: { type: Date, default: Date.now },
  chatId: { type: Number },
});

export const AdvisorInsight = mongoose.model("AdvisorInsight", AdvisorInsightSchema);
export const PerformanceSnapshot = mongoose.model("PerformanceSnapshot", PerformanceSnapshotSchema);
export const AdvisorReport = mongoose.model("AdvisorReport", AdvisorReportSchema);
