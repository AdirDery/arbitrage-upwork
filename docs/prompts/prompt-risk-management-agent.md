# Prompt — Risk Management Agent (Zero Cost, Brain System, Telegram Reports)

## Context

The Crypto Arbitrage Bot v2 has 5 strategies, paper trading, evolution, and an AI advisor — but **zero risk management**. There is no circuit breaker, no position limit, no daily loss cap. If the bot goes live with $1,000 and hits a bad streak, it can lose everything with no safety net.

The bot already has:
- `src/execution/ExecutionEngine.ts` — Sequential leg execution with rollback on failure
- `src/transactions/transaction.model.ts` — MongoDB transaction records with mode 'live'|'paper', status, profit in responseMsg
- `src/ai/TradingAdvisor.ts` — Zero-cost advisor pattern (monitoring loop + Telegram alerts)
- `src/ai/AdvisorBrain.ts` — Brain pattern with MongoDB persistence + rule-based analysis
- `src/ai/advisor.model.ts` — MongoDB schema pattern for insights/snapshots
- `src/adapters/exchangeAdapter.ts` — Abstract class with `getBalance(asset)` method (exists on all 5 adapters, currently returns fake `1000`)
- `src/config/config.model.ts` — Config model with capitalBinance, capitalBybit, etc.

**What's missing:**
- A **RiskManager** that wraps every trade and can BLOCK execution if limits are breached
- A **RiskBrain** that tracks cumulative P&L, drawdown, losing streaks, and learns patterns
- **Circuit breakers**: max daily loss, max consecutive losses, max position size
- **Telegram alerts** when risk limits are hit — the user must know immediately
- Risk config stored in MongoDB so it persists across restarts

**Files to create:**
- `src/risk/risk.model.ts` — MongoDB schemas for risk config, risk events, daily P&L tracking
- `src/risk/RiskBrain.ts` — Persistent brain that tracks all risk metrics
- `src/risk/RiskManager.ts` — The guardian — checks every trade against limits, can halt trading
- `src/risk/RiskReporter.ts` — Formats and sends risk reports to Telegram

**Files to modify:**
- `src/telegram/telegram.controller.ts` — Add /risk_status, /risk_config, /risk_reset commands

---

## TASK 1: Create Risk MongoDB Schemas

**File:** Create `src/risk/risk.model.ts`

```typescript
import mongoose, { Schema } from "mongoose";

// Persisted risk configuration — survives restarts
const RiskConfigSchema = new Schema({
  configId: { type: String, default: "default", unique: true },

  // Circuit breakers
  maxDailyLossUSD: { type: Number, default: 50 },        // halt trading if daily loss > $50
  maxConsecutiveLosses: { type: Number, default: 5 },     // halt after 5 losses in a row
  maxTradeSize: { type: Number, default: 100 },           // max USDT per single trade
  maxOpenPositions: { type: Number, default: 3 },         // max concurrent positions
  maxDailyTrades: { type: Number, default: 100 },         // don't overtrade

  // Position sizing
  maxPortfolioRiskPct: { type: Number, default: 5 },      // max 5% of portfolio per trade
  totalCapitalUSD: { type: Number, default: 1000 },       // total capital across all exchanges

  // Cooldown
  cooldownAfterHaltMinutes: { type: Number, default: 60 },// wait 1h after halt before resuming
  autoResumeEnabled: { type: Boolean, default: true },    // auto-resume after cooldown

  updatedAt: { type: Date, default: Date.now },
});

// Tracks daily P&L and risk events
const DailyRiskRecordSchema = new Schema({
  date: { type: String, required: true, index: true },    // "2026-04-11" format
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
    type: { type: String },     // "halt", "resume", "warning", "trade"
    reason: { type: String },
    value: { type: Number },
    timestamp: { type: Date, default: Date.now },
  }],
});

// Individual risk events for historical analysis
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
```

---

## TASK 2: Create the Risk Brain

**File:** Create `src/risk/RiskBrain.ts`

```typescript
import { RiskConfig, DailyRiskRecord, RiskEvent } from "./risk.model";
import { Transaction } from "../transactions/transaction.model";
import logger from "../core/logger.service";

/**
 * Risk Brain — tracks all risk metrics, persists to MongoDB.
 * Zero API cost. Pure rule-based analysis.
 *
 * Tracks:
 * - Daily P&L (cumulative)
 * - Consecutive losses (current streak)
 * - Drawdown (peak-to-trough)
 * - Trade count per day
 * - Halt/resume history
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

  /** Initialize — load today's record from MongoDB */
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

  /** Record a completed trade and update all metrics */
  async recordTrade(profit: number, strategyId: string, exchangePair: string): Promise<void> {
    // Roll over to new day if needed
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

    // Track peak P&L for drawdown calculation
    if (this.dailyPnL > this.peakPnL) {
      this.peakPnL = this.dailyPnL;
    }

    // Persist to MongoDB
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

  /** Check if a trade should be allowed — returns { allowed, reason } */
  async checkTradeAllowed(tradeSizeUSD: number): Promise<{ allowed: boolean; reason: string }> {
    const config = await this.getConfig();

    // 1. Is trading halted?
    if (this.isHalted) {
      // Check if cooldown expired
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

  /** Halt all trading */
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

  /** Resume trading */
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

  /** Get current risk status */
  getStatus(): {
    dailyPnL: number;
    tradeCount: number;
    consecutiveLosses: number;
    drawdown: number;
    isHalted: boolean;
    haltReason: string;
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

  /** Get risk config from MongoDB (with defaults) */
  async getConfig(): Promise<any> {
    let config = await RiskConfig.findOne({ configId: "default" });
    if (!config) {
      config = await RiskConfig.create({ configId: "default" });
    }
    return config;
  }

  /** Update risk config */
  async updateConfig(updates: Record<string, number | boolean>): Promise<void> {
    await RiskConfig.findOneAndUpdate(
      { configId: "default" },
      { $set: { ...updates, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  /** Get recent risk events */
  async getRecentEvents(limit: number = 10): Promise<any[]> {
    return RiskEvent.find().sort({ timestamp: -1 }).limit(limit).lean();
  }

  /** Get weekly risk summary */
  async getWeeklySummary(): Promise<{
    totalPnL: number;
    totalTrades: number;
    winRate: number;
    halts: number;
    worstDay: string;
    bestDay: string;
  }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateKey = this.getDateKey(sevenDaysAgo);

    const records = await DailyRiskRecord.find({
      date: { $gte: dateKey },
    }).lean();

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
      totalPnL,
      totalTrades,
      winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
      halts,
      worstDay: worstDay.date || "N/A",
      bestDay: bestDay.date || "N/A",
    };
  }

  /** Generate rule-based risk recommendations */
  async generateRecommendations(): Promise<string[]> {
    const config = await this.getConfig();
    const status = this.getStatus();
    const weekly = await this.getWeeklySummary();
    const recs: string[] = [];

    // Daily loss proximity warning
    if (status.dailyPnL < 0) {
      const pctUsed = (Math.abs(status.dailyPnL) / config.maxDailyLossUSD) * 100;
      if (pctUsed > 70) {
        recs.push(`Daily loss at ${pctUsed.toFixed(0)}% of limit ($${Math.abs(status.dailyPnL).toFixed(2)}/$${config.maxDailyLossUSD}). Consider reducing trade sizes.`);
      }
    }

    // Losing streak warning
    if (status.consecutiveLosses >= 3 && status.consecutiveLosses < config.maxConsecutiveLosses) {
      recs.push(`${status.consecutiveLosses} consecutive losses. ${config.maxConsecutiveLosses - status.consecutiveLosses} more triggers circuit breaker.`);
    }

    // Overtrading
    if (status.tradeCount > config.maxDailyTrades * 0.8) {
      recs.push(`${status.tradeCount} trades today — approaching daily limit of ${config.maxDailyTrades}. Bot will pause at limit.`);
    }

    // Weekly pattern
    if (weekly.halts >= 3) {
      recs.push(`${weekly.halts} circuit breaker halts this week. Consider widening profit thresholds or switching strategies.`);
    }

    if (weekly.winRate < 0.4 && weekly.totalTrades >= 10) {
      recs.push(`Weekly win rate is ${(weekly.winRate * 100).toFixed(0)}%. Market conditions may not favor current strategies. Review and adjust.`);
    }

    if (weekly.totalPnL > 0 && weekly.winRate > 0.6) {
      recs.push(`Positive week: $${weekly.totalPnL.toFixed(2)} with ${(weekly.winRate * 100).toFixed(0)}% win rate. System is working well.`);
    }

    // Capital efficiency
    if (config.maxTradeSize > config.totalCapitalUSD * 0.1) {
      recs.push(`Max trade size ($${config.maxTradeSize}) is >${10}% of capital. Consider reducing to manage risk.`);
    }

    if (recs.length === 0) {
      recs.push("Risk parameters are healthy. No adjustments needed.");
    }

    return recs;
  }

  private rolloverDay(): Promise<void> {
    // Reset daily counters
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
```

---

## TASK 3: Create the Risk Manager (Trade Guardian)

**File:** Create `src/risk/RiskManager.ts`

```typescript
import { TelegramBot } from "typescript-telegram-bot-api";
import { riskBrain } from "./RiskBrain";
import { RiskEvent } from "./risk.model";
import logger from "../core/logger.service";

/**
 * Risk Manager — the guardian that sits between strategies and execution.
 *
 * Every trade must pass through checkTrade() before execution.
 * Monitors continuously and sends Telegram alerts on risk events.
 *
 * Zero API cost — all rule-based.
 *
 * Monitoring schedule:
 * - Every trade: pre-trade risk check
 * - Every 10 min: risk status check + drawdown monitoring
 * - Every 4 hours: risk summary report
 */
export class RiskManager {
  private bot: TelegramBot | null = null;
  private chatId: number | null = null;
  private isRunning = false;
  private monitorTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private lastAlertTime: number = 0;

  async start(bot: TelegramBot, chatId: number): Promise<void> {
    if (this.isRunning) return;

    this.bot = bot;
    this.chatId = chatId;
    this.isRunning = true;

    await riskBrain.initialize();

    // Monitor every 10 minutes
    this.monitorTimer = setInterval(() => this.monitorCycle(), 10 * 60 * 1000);

    // Risk report every 4 hours
    this.reportTimer = setInterval(() => this.sendRiskReport(), 4 * 60 * 60 * 1000);

    logger.info("[RiskManager] Started");
  }

  stop(): void {
    this.isRunning = false;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.monitorTimer = null;
    this.reportTimer = null;
    logger.info("[RiskManager] Stopped");
  }

  /**
   * PRE-TRADE CHECK — call this before every trade execution.
   * Returns { allowed: true } or { allowed: false, reason: "..." }
   */
  async checkTrade(tradeSizeUSD: number): Promise<{ allowed: boolean; reason: string }> {
    const result = await riskBrain.checkTradeAllowed(tradeSizeUSD);

    if (!result.allowed) {
      logger.warn(`[RiskManager] Trade BLOCKED: ${result.reason}`);
      await this.sendAlertIfNeeded("🚫", "Trade Blocked", result.reason);
    }

    return result;
  }

  /**
   * POST-TRADE RECORD — call this after every trade completes.
   */
  async recordTrade(profit: number, strategyId: string, exchangePair: string): Promise<void> {
    await riskBrain.recordTrade(profit, strategyId, exchangePair);

    const status = riskBrain.getStatus();

    // Check if we just got halted
    if (status.isHalted) {
      await this.sendAlert("🛑", "CIRCUIT BREAKER TRIGGERED", status.haltReason);
    }

    // Losing streak warning (before halt threshold)
    const config = await riskBrain.getConfig();
    if (status.consecutiveLosses >= 3 && status.consecutiveLosses < config.maxConsecutiveLosses) {
      await this.sendAlertIfNeeded(
        "⚠️",
        `Losing Streak: ${status.consecutiveLosses} in a row`,
        `${config.maxConsecutiveLosses - status.consecutiveLosses} more losses will trigger circuit breaker.`
      );
    }

    // Drawdown warning at 50% of daily limit
    if (status.dailyPnL < 0) {
      const pctUsed = (Math.abs(status.dailyPnL) / config.maxDailyLossUSD) * 100;
      if (pctUsed > 50 && pctUsed < 100) {
        await this.sendAlertIfNeeded(
          "📉",
          `Drawdown Warning: ${pctUsed.toFixed(0)}% of daily limit`,
          `Loss: $${Math.abs(status.dailyPnL).toFixed(2)} / Max: $${config.maxDailyLossUSD}`
        );
      }
    }
  }

  /** Periodic monitoring */
  private async monitorCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const status = riskBrain.getStatus();
      const config = await riskBrain.getConfig();

      // Check if halted and cooldown expired
      if (status.isHalted && config.autoResumeEnabled) {
        // The checkTradeAllowed handles auto-resume, but we can alert here
        logger.info(`[RiskManager] Trading halted: ${status.haltReason}`);
      }
    } catch (err) {
      logger.error("[RiskManager] Monitor error", err);
    }
  }

  /** Risk summary report every 4 hours */
  async sendRiskReport(): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const status = riskBrain.getStatus();
      const config = await riskBrain.getConfig();
      const weekly = await riskBrain.getWeeklySummary();
      const recs = await riskBrain.generateRecommendations();

      const pnlIcon = status.dailyPnL >= 0 ? "🟢" : "🔴";
      const haltIcon = status.isHalted ? "🛑 HALTED" : "✅ Active";

      // Daily loss bar
      const lossLimit = config.maxDailyLossUSD;
      const lossPct = status.dailyPnL < 0 ? Math.min(100, (Math.abs(status.dailyPnL) / lossLimit) * 100) : 0;
      const barLen = 10;
      const filled = Math.round((lossPct / 100) * barLen);
      const lossBar = "█".repeat(filled) + "░".repeat(barLen - filled);

      let recLines = "";
      for (let i = 0; i < Math.min(4, recs.length); i++) {
        recLines += `${i + 1}\\. ${this.esc(recs[i])}\n`;
      }

      const msg =
`╔══════════════════════════════════╗
║     🛡️ RISK MANAGEMENT REPORT    ║
╚══════════════════════════════════╝

*Status:* ${haltIcon}
${pnlIcon} *Daily P&L:* $${this.esc(status.dailyPnL.toFixed(2))}
📊 *Trades Today:* ${status.tradeCount} / ${config.maxDailyTrades}
🔴 *Losing Streak:* ${status.consecutiveLosses} / ${config.maxConsecutiveLosses}

━━━━━ Daily Loss Meter ━━━━━

${this.esc(lossBar)} ${this.esc(lossPct.toFixed(0))}%
Limit: $${this.esc(String(config.maxDailyLossUSD))}

━━━━━ Weekly Summary ━━━━━━

💰 *Week P&L:* $${this.esc(weekly.totalPnL.toFixed(2))}
📊 *Week Trades:* ${weekly.totalTrades}
🎯 *Week Win Rate:* ${this.esc((weekly.winRate * 100).toFixed(0))}%
🛑 *Halts This Week:* ${weekly.halts}

━━━━━━ Risk Config ━━━━━━━

  Max Daily Loss: $${this.esc(String(config.maxDailyLossUSD))}
  Max Trade Size: $${this.esc(String(config.maxTradeSize))}
  Max Streak: ${config.maxConsecutiveLosses} losses
  Capital: $${this.esc(String(config.totalCapitalUSD))}

━━━━━ 🧠 Recommendations ━━━━━

${recLines}`;

      await this.bot.sendMessage({ chat_id: this.chatId, text: msg, parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error("[RiskManager] Risk report error", err);
    }
  }

  /** Send immediate alert */
  private async sendAlert(emoji: string, title: string, detail: string): Promise<void> {
    if (!this.bot || !this.chatId) return;

    const msg =
`${emoji} *RISK ALERT*

*${this.esc(title)}*

${this.esc(detail)}`;

    try {
      await this.bot.sendMessage({ chat_id: this.chatId, text: msg, parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error("[RiskManager] Alert error", err);
    }
  }

  /** Rate-limited alert — max 1 per 3 minutes */
  private async sendAlertIfNeeded(emoji: string, title: string, detail: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTime < 3 * 60 * 1000) return;
    this.lastAlertTime = now;
    await this.sendAlert(emoji, title, detail);
  }

  /** Manual trigger for /risk_status */
  async triggerReport(bot: TelegramBot, chatId: number): Promise<void> {
    this.bot = bot;
    this.chatId = chatId;
    await riskBrain.initialize();
    await this.sendRiskReport();
  }

  getStatus(): { running: boolean; halted: boolean; haltReason: string } {
    const brainStatus = riskBrain.getStatus();
    return {
      running: this.isRunning,
      halted: brainStatus.isHalted,
      haltReason: brainStatus.haltReason,
    };
  }

  private esc(text: string): string {
    return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
  }
}

export const riskManager = new RiskManager();
```

---

## TASK 4: Add Telegram Commands

**File:** Modify `src/telegram/telegram.controller.ts`

### Step 1: Add import at top

After existing imports add:
```typescript
import { riskManager } from "../risk/RiskManager";
import { riskBrain } from "../risk/RiskBrain";
```

### Step 2: Add commands to setCommands() array

Add these entries:
```typescript
      { command: 'risk_status', description: 'Risk management report' },
      { command: 'risk_reset', description: 'Resume trading after halt' },
```

### Step 3: Add command routing in registerHandlers

Add after the `/dashboard` handler routing:
```typescript
      // ─── Risk Commands ───
      if(messageText === "/risk_status"){
        await this.handleRiskStatus(chatId);
      }
      if(messageText === "/risk_reset"){
        await this.handleRiskReset(chatId);
      }
```

### Step 4: Add handler methods

Add before the `handleDashboard` method:
```typescript
  // ─── Risk Management Handlers ──────────────────────────────

  private async handleRiskStatus(chatId: number) {
    await this.bot.sendMessage({
      chat_id: chatId,
      text: "⏳ Loading risk report\\.\\.\\.",
      parse_mode: "MarkdownV2",
    });

    try {
      await riskManager.triggerReport(this.bot, chatId);
    } catch (error) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "❌ Error loading risk status\\.",
        parse_mode: "MarkdownV2",
      });
    }
  }

  private async handleRiskReset(chatId: number) {
    try {
      await riskBrain.initialize();
      await riskBrain.resumeTrading("Manual reset by user via /risk_reset");

      await this.bot.sendMessage({
        chat_id: chatId,
        text:
`╔══════════════════════════════════╗
║    ✅ TRADING RESUMED             ║
╚══════════════════════════════════╝

Circuit breaker reset\\. Trading is now active\\.
Consecutive loss counter reset to 0\\.

⚠️ Risk limits still apply:
  \\- Daily loss limit
  \\- Max trade size
  \\- Losing streak limit

Use /risk\\_status to check current risk state\\.`,
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "❌ Error resetting risk state\\.",
        parse_mode: "MarkdownV2",
      });
    }
  }
```

### Step 5: Auto-start risk manager when advisor starts

In the existing `handleAdvisorStart` method, add this line after `await tradingAdvisor.start(this.bot, chatId);`:
```typescript
      await riskManager.start(this.bot, chatId);
```

And in `handleAdvisorStop`, add before `tradingAdvisor.stop();`:
```typescript
      riskManager.stop();
```

---

## Execution Order

1. **TASK 1** — `src/risk/risk.model.ts` (schemas, no deps)
2. **TASK 2** — `src/risk/RiskBrain.ts` (depends on Task 1)
3. **TASK 3** — `src/risk/RiskManager.ts` (depends on Task 2)
4. **TASK 4** — `src/telegram/telegram.controller.ts` (depends on Task 3)

## Rules

- **Protocol 7** (AI/ML Feature) + **Protocol 4** (Telegram Command)
- **ZERO external API calls** — all rule-based using MongoDB + in-memory counters
- Every trade MUST pass through `riskManager.checkTrade()` before execution
- Every completed trade MUST call `riskManager.recordTrade()` after execution
- Circuit breaker halts are CRITICAL alerts — sent immediately, not rate-limited
- Risk config persists in MongoDB — survives bot restarts
- Daily records roll over at midnight UTC automatically
- All Telegram messages use MarkdownV2 with esc() helper
- Try/catch all MongoDB queries and Telegram sends

## Verification

```bash
# Build — zero errors
npm run build

# Start
npm start

# In Telegram:
# /risk_status     → Risk report with daily P&L, weekly summary, recommendations
# /risk_reset      → Resume trading after circuit breaker halt
# /advisor_start   → Now also starts risk manager alongside advisor

# Verify MongoDB collections created:
# - riskconfigs
# - dailyriskrecords
# - riskevents
```

## Integration Points (for when live trading is added)

When you implement live trading, every trade must go through the risk manager:

```typescript
// BEFORE executing any trade:
const check = await riskManager.checkTrade(tradeSizeUSD);
if (!check.allowed) {
  logger.warn(`Trade blocked by risk manager: ${check.reason}`);
  return; // DO NOT EXECUTE
}

// Execute the trade...
const result = await executionEngine.execute(opportunity);

// AFTER the trade completes:
await riskManager.recordTrade(result.actualProfit, strategyId, exchangePair);
```

This two-step pattern (check before, record after) is how the risk manager protects your capital.
