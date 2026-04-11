import mongoose, { Schema } from "mongoose";

const RiskConfigSchema = new Schema({
  configId: { type: String, default: "default", unique: true },
  maxDailyLossUSD: { type: Number, default: 50 },
  maxConsecutiveLosses: { type: Number, default: 5 },
  maxTradeSize: { type: Number, default: 100 },
  maxOpenPositions: { type: Number, default: 3 },
  maxDailyTrades: { type: Number, default: 100 },
  maxPortfolioRiskPct: { type: Number, default: 5 },
  totalCapitalUSD: { type: Number, default: 1000 },
  cooldownAfterHaltMinutes: { type: Number, default: 60 },
  autoResumeEnabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
});

const DailyRiskRecordSchema = new Schema({
  date: { type: String, required: true, index: true },
  totalPnL: { type: Number, default: 0 },
  tradeCount: { type: Number, default: 0 },
  winCount: { type: Number, default: 0 },
  lossCount: { type: Number, default: 0 },
  consecutiveLosses: { type: Number, default: 0 },
  maxConsecutiveLosses: { type: Number, default: 0 },
  maxDrawdown: { type: Number, default: 0 },
  peakPnL: { type: Number, default: 0 },
  isHalted: { type: Boolean, default: false },
  haltReason: { type: String },
  haltedAt: { type: Date },
  resumedAt: { type: Date },
  events: [{
    type: { type: String },
    reason: { type: String },
    value: { type: Number },
    timestamp: { type: Date, default: Date.now },
  }],
});

const RiskEventSchema = new Schema({
  type: {
    type: String,
    enum: ["halt", "resume", "warning", "trade_blocked", "drawdown_alert", "streak_alert", "balance_alert"],
    required: true,
  },
  severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
});

export const RiskConfig = mongoose.model("RiskConfig", RiskConfigSchema);
export const DailyRiskRecord = mongoose.model("DailyRiskRecord", DailyRiskRecordSchema);
export const RiskEvent = mongoose.model("RiskEvent", RiskEventSchema);
