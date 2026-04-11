import { RiskConfig, DailyRiskRecord, RiskEvent } from "./risk.model";
import logger from "../core/logger.service";

/**
 * Risk Brain — tracks all risk metrics, persists to MongoDB.
 * Zero API cost. Pure rule-based analysis.
 */
export class RiskBrain {
  private todayKey: string = "";
  private dailyPnL: number = 0;
  private consecutiveLosses: number = 0;
  private tradeCountToday: number = 0;
  private peakPnL: number = 0;
  private isHalted: boolean = false;
  private haltReason: string = "";
  private haltedAt: number = 0;

  async initialize(): Promise<void> {
    this.todayKey = this.getDateKey();
    const record = await DailyRiskRecord.findOne({ date: this.todayKey });

    if (record) {
      const r = record as any;
      this.dailyPnL = r.totalPnL || 0;
      this.consecutiveLosses = r.consecutiveLosses || 0;
      this.tradeCountToday = r.tradeCount || 0;
      this.peakPnL = r.peakPnL || 0;
      this.isHalted = r.isHalted || false;
      this.haltReason = r.haltReason || "";
    }

    logger.info(`[RiskBrain] Initialized | Daily P&L: $${this.dailyPnL.toFixed(2)} | Trades: ${this.tradeCountToday} | Halted: ${this.isHalted}`);
  }

  async recordTrade(profit: number, strategyId: string, exchangePair: string): Promise<void> {
    const today = this.getDateKey();
    if (today !== this.todayKey) {
      await this.rolloverDay();
      this.todayKey = today;
    }

    this.dailyPnL += profit;
    this.tradeCountToday++;

    if (profit > 0) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
    }

    if (this.dailyPnL > this.peakPnL) {
      this.peakPnL = this.dailyPnL;
    }

    await DailyRiskRecord.findOneAndUpdate(
      { date: this.todayKey },
      {
        $set: {
          totalPnL: this.dailyPnL,
          tradeCount: this.tradeCountToday,
          consecutiveLosses: this.consecutiveLosses,
          peakPnL: this.peakPnL,
          maxDrawdown: Math.max(0, this.peakPnL - this.dailyPnL),
          isHalted: this.isHalted,
          haltReason: this.haltReason,
        },
        $inc: profit > 0 ? { winCount: 1 } : { lossCount: 1 },
        $push: {
          events: {
            type: "trade",
            reason: `${strategyId} on ${exchangePair}: $${profit.toFixed(4)}`,
            value: profit,
            timestamp: new Date(),
          },
        },
      },
      { upsert: true }
    );
  }

  async checkTradeAllowed(tradeSizeUSD: number): Promise<{ allowed: boolean; reason: string }> {
    const config = await this.getConfig();

    // 1. Is trading halted?
    if (this.isHalted) {
      if (config.autoResumeEnabled && this.haltedAt > 0) {
        const cooldownMs = config.cooldownAfterHaltMinutes * 60 * 1000;
        if (Date.now() - this.haltedAt > cooldownMs) {
          await this.resumeTrading("Cooldown expired — auto-resuming");
        } else {
          const remaining = Math.ceil((cooldownMs - (Date.now() - this.haltedAt)) / 60000);
          return { allowed: false, reason: `Trading halted: ${this.haltReason}. Resumes in ${remaining} min.` };
        }
      } else {
        return { allowed: false, reason: `Trading halted: ${this.haltReason}. Use /risk_reset to resume.` };
      }
    }

    // 2. Max daily loss
    if (this.dailyPnL <= -config.maxDailyLossUSD) {
      await this.haltTrading(`Daily loss limit hit: $${Math.abs(this.dailyPnL).toFixed(2)} > $${config.maxDailyLossUSD}`);
      return { allowed: false, reason: `Daily loss limit: $${this.dailyPnL.toFixed(2)}` };
    }

    // 3. Max consecutive losses
    if (this.consecutiveLosses >= config.maxConsecutiveLosses) {
      await this.haltTrading(`${this.consecutiveLosses} consecutive losses`);
      return { allowed: false, reason: `${this.consecutiveLosses} losses in a row` };
    }

    // 4. Max trade size
    if (tradeSizeUSD > config.maxTradeSize) {
      return { allowed: false, reason: `Trade size $${tradeSizeUSD.toFixed(2)} exceeds max $${config.maxTradeSize}` };
    }

    // 5. Max portfolio risk per trade
    const maxAllowed = config.totalCapitalUSD * (config.maxPortfolioRiskPct / 100);
    if (tradeSizeUSD > maxAllowed) {
      return { allowed: false, reason: `Trade size $${tradeSizeUSD.toFixed(2)} exceeds ${config.maxPortfolioRiskPct}% of capital ($${maxAllowed.toFixed(2)})` };
    }

    // 6. Max daily trades
    if (this.tradeCountToday >= config.maxDailyTrades) {
      return { allowed: false, reason: `Daily trade limit reached: ${this.tradeCountToday}/${config.maxDailyTrades}` };
    }

    return { allowed: true, reason: "OK" };
  }

  async haltTrading(reason: string): Promise<void> {
    this.isHalted = true;
    this.haltReason = reason;
    this.haltedAt = Date.now();

    await DailyRiskRecord.findOneAndUpdate(
      { date: this.todayKey },
      { $set: { isHalted: true, haltReason: reason, haltedAt: new Date() } },
      { upsert: true }
    );

    await RiskEvent.create({ type: "halt", severity: "critical", message: reason });
    logger.warn(`[RiskBrain] TRADING HALTED: ${reason}`);
  }

  async resumeTrading(reason: string): Promise<void> {
    this.isHalted = false;
    this.haltReason = "";
    this.haltedAt = 0;
    this.consecutiveLosses = 0;

    await DailyRiskRecord.findOneAndUpdate(
      { date: this.todayKey },
      { $set: { isHalted: false, haltReason: "", resumedAt: new Date(), consecutiveLosses: 0 } },
      { upsert: true }
    );

    await RiskEvent.create({ type: "resume", severity: "info", message: reason });
    logger.info(`[RiskBrain] Trading resumed: ${reason}`);
  }

  getStatus(): {
    dailyPnL: number; tradeCount: number; consecutiveLosses: number;
    drawdown: number; isHalted: boolean; haltReason: string;
  } {
    return {
      dailyPnL: this.dailyPnL,
      tradeCount: this.tradeCountToday,
      consecutiveLosses: this.consecutiveLosses,
      drawdown: Math.max(0, this.peakPnL - this.dailyPnL),
      isHalted: this.isHalted,
      haltReason: this.haltReason,
    };
  }

  async getConfig(): Promise<any> {
    let config = await RiskConfig.findOne({ configId: "default" });
    if (!config) {
      config = await RiskConfig.create({ configId: "default" });
    }
    return config;
  }

  async updateConfig(updates: Record<string, number | boolean>): Promise<void> {
    await RiskConfig.findOneAndUpdate(
      { configId: "default" },
      { $set: { ...updates, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async getRecentEvents(limit: number = 10): Promise<any[]> {
    return RiskEvent.find().sort({ timestamp: -1 }).limit(limit).lean();
  }

  async getWeeklySummary(): Promise<{
    totalPnL: number; totalTrades: number; winRate: number;
    halts: number; worstDay: string; bestDay: string;
  }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateKey = this.getDateKey(sevenDaysAgo);

    const records = await DailyRiskRecord.find({ date: { $gte: dateKey } }).lean();

    let totalPnL = 0, totalTrades = 0, totalWins = 0, halts = 0;
    let worstDay = { date: "", pnl: Infinity };
    let bestDay = { date: "", pnl: -Infinity };

    for (const r of records as any[]) {
      totalPnL += r.totalPnL || 0;
      totalTrades += r.tradeCount || 0;
      totalWins += r.winCount || 0;
      if (r.isHalted) halts++;
      if (r.totalPnL < worstDay.pnl) worstDay = { date: r.date, pnl: r.totalPnL };
      if (r.totalPnL > bestDay.pnl) bestDay = { date: r.date, pnl: r.totalPnL };
    }

    return {
      totalPnL, totalTrades,
      winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
      halts,
      worstDay: worstDay.date || "N/A",
      bestDay: bestDay.date || "N/A",
    };
  }

  async generateRecommendations(): Promise<string[]> {
    const config = await this.getConfig();
    const status = this.getStatus();
    const weekly = await this.getWeeklySummary();
    const recs: string[] = [];

    if (status.dailyPnL < 0) {
      const pctUsed = (Math.abs(status.dailyPnL) / config.maxDailyLossUSD) * 100;
      if (pctUsed > 70) {
        recs.push(`Daily loss at ${pctUsed.toFixed(0)}% of limit ($${Math.abs(status.dailyPnL).toFixed(2)}/$${config.maxDailyLossUSD}). Consider reducing trade sizes.`);
      }
    }

    if (status.consecutiveLosses >= 3 && status.consecutiveLosses < config.maxConsecutiveLosses) {
      recs.push(`${status.consecutiveLosses} consecutive losses. ${config.maxConsecutiveLosses - status.consecutiveLosses} more triggers circuit breaker.`);
    }

    if (status.tradeCount > config.maxDailyTrades * 0.8) {
      recs.push(`${status.tradeCount} trades today — approaching daily limit of ${config.maxDailyTrades}.`);
    }

    if (weekly.halts >= 3) {
      recs.push(`${weekly.halts} circuit breaker halts this week. Consider widening profit thresholds or switching strategies.`);
    }

    if (weekly.winRate < 0.4 && weekly.totalTrades >= 10) {
      recs.push(`Weekly win rate is ${(weekly.winRate * 100).toFixed(0)}%. Market conditions may not favor current strategies.`);
    }

    if (weekly.totalPnL > 0 && weekly.winRate > 0.6) {
      recs.push(`Positive week: $${weekly.totalPnL.toFixed(2)} with ${(weekly.winRate * 100).toFixed(0)}% win rate. System is working well.`);
    }

    if (config.maxTradeSize > config.totalCapitalUSD * 0.1) {
      recs.push(`Max trade size ($${config.maxTradeSize}) is >10% of capital. Consider reducing to manage risk.`);
    }

    if (recs.length === 0) {
      recs.push("Risk parameters are healthy. No adjustments needed.");
    }

    return recs;
  }

  private rolloverDay(): Promise<void> {
    this.dailyPnL = 0;
    this.tradeCountToday = 0;
    this.consecutiveLosses = 0;
    this.peakPnL = 0;
    this.isHalted = false;
    this.haltReason = "";
    return Promise.resolve();
  }

  private getDateKey(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().slice(0, 10);
  }
}

export const riskBrain = new RiskBrain();
