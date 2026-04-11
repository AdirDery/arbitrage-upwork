# Prompt — Trading Advisor Agent (Zero Cost, No API)

## Context

The Crypto Arbitrage Bot v2 has 5 strategies, genetic evolution, paper trading, and AI analysis modules. The current AI layer uses Claude API (costs money) and is passive — only responds to `/ai_report`. We need an autonomous advisor that monitors everything and sends Telegram reports using **zero external API calls** — pure local computation with rule-based analysis.

**What exists (use these, don't call any API):**
- `src/ai/MarketRegimeDetector.ts` — Classifies market as calm/volatile/trending/choppy using simple-statistics
- `src/ai/OpportunityScorer.ts` — Logistic regression scoring (local, no API)
- `src/ai/CorrelationTracker.ts` — Tracks pair correlations and z-score divergence (local)
- `src/evolution/evolution.model.ts` — MongoDB: BrainRecord, GenerationRecord
- `src/transactions/transaction.model.ts` — MongoDB: all trade transactions
- `src/paper/PaperTradingEngine.ts` — Paper trading performance data
- `src/telegram/telegram.controller.ts` — Telegram commands

**Files to create:**
- `src/ai/TradingAdvisor.ts` — Core advisor: monitoring loop + rule-based analysis engine
- `src/ai/AdvisorBrain.ts` — Persistent knowledge base (MongoDB) that learns from trade history
- `src/ai/advisor.model.ts` — MongoDB schemas

**Files to modify:**
- `src/telegram/telegram.controller.ts` — Add /advisor_start, /advisor_stop, /advisor_report

**IMPORTANT: Zero external API calls. No Claude API, no OpenAI, no paid services. All analysis is rule-based using existing data + simple-statistics library.**

---

## TASK 1: Create MongoDB Schemas

**File:** Create `src/ai/advisor.model.ts`

```typescript
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
```

---

## TASK 2: Create the Advisor Brain (Local Learning System)

**File:** Create `src/ai/AdvisorBrain.ts`

```typescript
import { AdvisorInsight, PerformanceSnapshot } from "./advisor.model";
import { Transaction } from "../transactions/transaction.model";
import { GenerationRecord, BrainRecord } from "../evolution/evolution.model";
import { marketRegimeDetector } from "./MarketRegimeDetector";
import { correlationTracker } from "./CorrelationTracker";
import logger from "../core/logger.service";

/**
 * Local brain — no API calls. Learns from:
 * 1. Trade history (MongoDB)
 * 2. Market regime patterns (MarketRegimeDetector)
 * 3. Correlation divergences (CorrelationTracker)
 * 4. Evolution brain performance (GenerationRecord)
 */
export class AdvisorBrain {

  /**
   * Analyze recent trades — pure MongoDB query, no API.
   */
  async analyzeTradeHistory(hoursBack: number = 24): Promise<{
    totalTrades: number;
    pnl: number;
    winRate: number;
    bestStrategy: string;
    bestExchangePair: string;
    worstExchangePair: string;
    strategyBreakdown: Record<string, { trades: number; pnl: number; winRate: number }>;
    peakHour: number;
  }> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const transactions = await Transaction.find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 }).limit(500);

    const strategyPnL: Record<string, { trades: number; pnl: number; wins: number }> = {};
    const exchangePnL: Record<string, { trades: number; pnl: number }> = {};
    const hourlyDist: Record<number, number> = {};
    let totalPnL = 0;
    let totalWins = 0;

    for (const tx of transactions) {
      const t = tx as any;
      const type = t.type || "unknown";
      const exchange = t.exchange || "unknown";
      const profit = parseFloat(t.responseMsg?.match(/Profit:\s*([-\d.]+)/)?.[1] || "0");
      const hour = new Date(t.timestamp).getUTCHours();

      if (!strategyPnL[type]) strategyPnL[type] = { trades: 0, pnl: 0, wins: 0 };
      strategyPnL[type].trades++;
      strategyPnL[type].pnl += profit;
      if (profit > 0) strategyPnL[type].wins++;

      if (!exchangePnL[exchange]) exchangePnL[exchange] = { trades: 0, pnl: 0 };
      exchangePnL[exchange].trades++;
      exchangePnL[exchange].pnl += profit;

      hourlyDist[hour] = (hourlyDist[hour] || 0) + 1;
      totalPnL += profit;
      if (profit > 0) totalWins++;
    }

    const bestStrategy = Object.entries(strategyPnL)
      .sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0] || "none";
    const exchangeEntries = Object.entries(exchangePnL).sort((a, b) => b[1].pnl - a[1].pnl);
    const bestExchangePair = exchangeEntries[0]?.[0] || "none";
    const worstExchangePair = exchangeEntries[exchangeEntries.length - 1]?.[0] || "none";
    const peakHour = Object.entries(hourlyDist).sort((a, b) => b[1] - a[1])[0]
      ? Number(Object.entries(hourlyDist).sort((a, b) => b[1] - a[1])[0][0])
      : 0;

    const strategyBreakdown: Record<string, { trades: number; pnl: number; winRate: number }> = {};
    for (const [name, data] of Object.entries(strategyPnL)) {
      strategyBreakdown[name] = {
        trades: data.trades,
        pnl: data.pnl,
        winRate: data.trades > 0 ? data.wins / data.trades : 0,
      };
    }

    return {
      totalTrades: transactions.length,
      pnl: totalPnL,
      winRate: transactions.length > 0 ? totalWins / transactions.length : 0,
      bestStrategy,
      bestExchangePair,
      worstExchangePair,
      strategyBreakdown,
      peakHour,
    };
  }

  /**
   * Get market state — uses existing local modules, no API.
   */
  getMarketState(): {
    regime: string;
    volatility: number;
    spreadMean: number;
    recommendation: string;
    correlations: { pair: string; zScore: number; signal: string }[];
  } {
    marketRegimeDetector.recordSnapshot();
    const analysis = marketRegimeDetector.detectRegime();
    const divergences = correlationTracker.analyzePairs();

    return {
      regime: analysis.regime,
      volatility: analysis.volatility,
      spreadMean: analysis.spreadMean,
      recommendation: analysis.recommendation,
      correlations: divergences.map(d => ({
        pair: `${d.pair[0]}/${d.pair[1]}`,
        zScore: d.zScore,
        signal: d.signal,
      })),
    };
  }

  /**
   * Get evolution insights — pure MongoDB query.
   */
  async getEvolutionInsights(): Promise<{
    totalGenerations: number;
    bestFitness: number;
    bestStrategy: string;
    improving: boolean;
    topBrains: { id: string; strategy: string; fitness: number }[];
  }> {
    const generations = await GenerationRecord.find()
      .sort({ timestamp: -1 }).limit(5);

    if (generations.length === 0) {
      return { totalGenerations: 0, bestFitness: 0, bestStrategy: "none", improving: false, topBrains: [] };
    }

    const latest = generations[0] as any;
    const topBrainRecords = await BrainRecord.find()
      .sort({ fitness: -1 }).limit(5);

    const fitnessValues = generations.map((g: any) => g.bestFitness).reverse();
    const improving = fitnessValues.length >= 3 && fitnessValues[fitnessValues.length - 1] > fitnessValues[0];

    return {
      totalGenerations: latest.generation || 0,
      bestFitness: latest.bestFitness || 0,
      bestStrategy: (topBrainRecords[0] as any)?.strategyType || "unknown",
      improving,
      topBrains: topBrainRecords.map((b: any) => ({
        id: b.brainId?.slice(0, 15) || "?",
        strategy: b.strategyType || "?",
        fitness: b.fitness || 0,
      })),
    };
  }

  /**
   * Rule-based recommendations — the "AI" with zero cost.
   * Analyzes all data and generates specific, actionable advice.
   */
  async generateRecommendations(hoursBack: number = 24): Promise<string[]> {
    const trades = await this.analyzeTradeHistory(hoursBack);
    const market = this.getMarketState();
    const evo = await this.getEvolutionInsights();
    const recommendations: string[] = [];

    // === TRADE PERFORMANCE RULES ===
    if (trades.totalTrades === 0) {
      recommendations.push("No trades found. Spreads may be too tight. Lower profit threshold or focus on altcoin pairs with wider spreads.");
    } else if (trades.winRate < 0.3 && trades.totalTrades >= 5) {
      recommendations.push(`Low win rate (${(trades.winRate * 100).toFixed(0)}%). Increase profit threshold to filter out marginal trades.`);
    } else if (trades.winRate > 0.7) {
      recommendations.push(`High win rate (${(trades.winRate * 100).toFixed(0)}%). Consider increasing trade size to maximize profitable opportunities.`);
    }

    if (trades.pnl < 0 && trades.totalTrades > 10) {
      recommendations.push(`Negative P&L ($${trades.pnl.toFixed(2)}). Reduce trade sizes and tighten thresholds until performance improves.`);
    }

    // === STRATEGY-SPECIFIC RULES ===
    for (const [name, data] of Object.entries(trades.strategyBreakdown)) {
      if (data.trades >= 5 && data.winRate < 0.2) {
        recommendations.push(`Strategy "${name}" has very low win rate (${(data.winRate * 100).toFixed(0)}%). Consider pausing it.`);
      }
      if (data.trades >= 5 && data.winRate > 0.8) {
        recommendations.push(`Strategy "${name}" is performing well (${(data.winRate * 100).toFixed(0)}% win rate). Increase its allocation.`);
      }
    }

    if (!trades.strategyBreakdown["altcoin"] || (trades.strategyBreakdown["altcoin"]?.trades || 0) === 0) {
      recommendations.push("Altcoin arbitrage has no trades. This strategy targets 50+ low-cap pairs with 1-5% spreads — ensure it is running.");
    }

    // === MARKET REGIME RULES ===
    const modifiers = marketRegimeDetector.getParameterModifiers(market.regime as any);

    if (market.regime === "choppy") {
      recommendations.push("Choppy market detected. High whipsaw risk. Consider pausing active trading or using very strict thresholds (2x profit threshold).");
    } else if (market.regime === "volatile") {
      recommendations.push("Volatile market — wider spreads create more opportunities. Scan faster (0.5x interval) but use smaller sizes (0.7x) to manage risk.");
    } else if (market.regime === "calm") {
      recommendations.push("Calm market — tight spreads. Focus on altcoin pairs where spreads are naturally wider. Major pairs unlikely to have arb opportunities.");
    } else if (market.regime === "trending") {
      recommendations.push("Trending market — funding rate strategy is ideal here. Longs pay shorts (or vice versa), creating consistent funding income.");
    }

    // === CORRELATION / STAT ARB RULES ===
    for (const corr of market.correlations) {
      if (Math.abs(corr.zScore) > 2.5 && corr.signal !== "NEUTRAL") {
        recommendations.push(`Strong stat arb signal: ${corr.pair} z-score=${corr.zScore.toFixed(2)}. Signal: ${corr.signal}. Consider a pairs trade.`);
      }
    }

    // === EVOLUTION RULES ===
    if (evo.totalGenerations > 0) {
      if (evo.improving) {
        recommendations.push(`Evolution is improving (Gen ${evo.totalGenerations}). Best strategy: ${evo.bestStrategy}. Let it keep running.`);
      } else if (evo.totalGenerations >= 3 && !evo.improving) {
        recommendations.push(`Evolution fitness is stagnating after ${evo.totalGenerations} generations. Consider increasing mutation rate or adding new strategy types.`);
      }

      if (evo.bestStrategy !== "none") {
        recommendations.push(`Evolution's best brain uses ${evo.bestStrategy} strategy (fitness: ${evo.bestFitness.toFixed(3)}). Consider allocating more capital to this strategy.`);
      }
    }

    // === TIME-OF-DAY RULES ===
    if (trades.peakHour !== undefined && trades.totalTrades > 10) {
      recommendations.push(`Most trades happen at ${trades.peakHour}:00 UTC. Spreads may be widest during this hour — optimize scan intensity around it.`);
    }

    // === SPREAD RULES ===
    if (market.spreadMean > 0) {
      if (market.spreadMean < 0.02) {
        recommendations.push(`Average spread is very tight (${market.spreadMean.toFixed(4)}%). Hard to profit on major pairs. Altcoin and triangular arb are better bets.`);
      } else if (market.spreadMean > 0.1) {
        recommendations.push(`Wide average spread (${market.spreadMean.toFixed(4)}%). Good conditions for direct arbitrage. Increase scan speed.`);
      }
    }

    // Always include at least one recommendation
    if (recommendations.length === 0) {
      recommendations.push("All systems running normally. Continue monitoring. Paper trade before committing real capital.");
    }

    return recommendations;
  }

  /** Save a performance snapshot */
  async saveSnapshot(period: "hourly" | "daily"): Promise<void> {
    const trades = await this.analyzeTradeHistory(period === "hourly" ? 1 : 24);
    const market = this.getMarketState();

    await PerformanceSnapshot.create({
      period,
      totalTrades: trades.totalTrades,
      totalPnL: trades.pnl,
      winRate: trades.winRate,
      bestStrategy: trades.bestStrategy,
      bestExchangePair: trades.bestExchangePair,
      regime: market.regime,
      spreadsAvg: market.spreadMean,
    });
  }

  /** Save a learned insight */
  async saveInsight(category: string, title: string, content: string, confidence: number = 0.5): Promise<void> {
    await AdvisorInsight.create({ category, title, content, confidence });
  }

  /** Get performance trend */
  async getPerformanceTrend(period: "hourly" | "daily", count: number = 10): Promise<any[]> {
    return PerformanceSnapshot.find({ period }).sort({ timestamp: -1 }).limit(count).lean();
  }
}

export const advisorBrain = new AdvisorBrain();
```

---

## TASK 3: Create the Trading Advisor (Zero Cost)

**File:** Create `src/ai/TradingAdvisor.ts`

```typescript
import { TelegramBot } from "typescript-telegram-bot-api";
import { advisorBrain } from "./AdvisorBrain";
import { AdvisorReport } from "./advisor.model";
import { marketRegimeDetector } from "./MarketRegimeDetector";
import logger from "../core/logger.service";

/**
 * Autonomous Trading Advisor — ZERO API COST.
 *
 * All analysis is rule-based using:
 * - MarketRegimeDetector (simple-statistics)
 * - CorrelationTracker (simple-statistics)
 * - MongoDB trade history
 * - Evolution brain performance data
 *
 * Monitoring schedule:
 * - Every 5 min: regime changes, correlation signals, performance anomalies
 * - Hourly: performance snapshot + parameter guidance
 * - Every 6 hours: deep analysis with strategy recommendations
 *
 * Knows all arbitrage methods and recommends which to focus on:
 * - Direct (cross-exchange) — best in calm markets
 * - Triangular (3-leg) — finds hidden inefficiencies
 * - Altcoin (low-cap) — widest spreads, most opportunities
 * - Funding Rate (delta-neutral) — best in trending markets
 * - Statistical (pairs) — works in all conditions
 */
export class TradingAdvisor {
  private bot: TelegramBot | null = null;
  private chatId: number | null = null;
  private isRunning = false;
  private monitorTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private deepTimer: NodeJS.Timeout | null = null;
  private lastRegime: string = "calm";
  private lastAlertTime: number = 0;
  private startTime: number = 0;

  async start(bot: TelegramBot, chatId: number): Promise<void> {
    if (this.isRunning) return;

    this.bot = bot;
    this.chatId = chatId;
    this.isRunning = true;
    this.startTime = Date.now();

    logger.info("[TradingAdvisor] Started (zero cost mode)");

    // Monitor every 5 minutes
    this.monitorTimer = setInterval(() => this.monitorCycle(), 5 * 60 * 1000);

    // Hourly report
    this.hourlyTimer = setInterval(() => this.sendHourlyReport(), 60 * 60 * 1000);

    // Deep analysis every 6 hours
    this.deepTimer = setInterval(() => this.sendDeepReport(), 6 * 60 * 60 * 1000);

    // Run first cycle immediately
    await this.monitorCycle();
  }

  stop(): void {
    this.isRunning = false;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    if (this.deepTimer) clearInterval(this.deepTimer);
    this.monitorTimer = null;
    this.hourlyTimer = null;
    this.deepTimer = null;
    logger.info("[TradingAdvisor] Stopped");
  }

  /** Core monitoring — every 5 minutes */
  private async monitorCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const market = advisorBrain.getMarketState();

      // 1. Regime change alert
      if (market.regime !== this.lastRegime) {
        const modifiers = marketRegimeDetector.getParameterModifiers(market.regime as any);
        await this.sendAlert(
          "🔄",
          `Regime: ${this.lastRegime.toUpperCase()} → ${market.regime.toUpperCase()}`,
          `Vol: ${market.volatility.toFixed(1)}% | Spread: ${market.spreadMean.toFixed(4)}%\nAdjust: threshold x${modifiers.profitThresholdMultiplier}, size x${modifiers.tradeSizeMultiplier}`
        );
        this.lastRegime = market.regime;
      }

      // 2. Correlation divergence alerts
      for (const corr of market.correlations) {
        if (corr.signal !== "NEUTRAL" && Math.abs(corr.zScore) > 2.5) {
          await this.sendAlert(
            "📊",
            `Stat Arb Signal: ${corr.pair}`,
            `Z-Score: ${corr.zScore.toFixed(2)} | ${corr.signal}`
          );
        }
      }

      // 3. Performance anomaly
      const trades = await advisorBrain.analyzeTradeHistory(1);
      if (trades.totalTrades >= 5 && trades.winRate < 0.2) {
        await this.sendAlert(
          "⚠️",
          `Very low win rate: ${(trades.winRate * 100).toFixed(0)}%`,
          `${trades.totalTrades} trades last hour | P&L: $${trades.pnl.toFixed(2)}\nConsider pausing or increasing profit threshold.`
        );
      }
    } catch (err) {
      logger.error("[TradingAdvisor] Monitor error", err);
    }
  }

  /** Hourly performance snapshot */
  async sendHourlyReport(): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      await advisorBrain.saveSnapshot("hourly");
      const trades = await advisorBrain.analyzeTradeHistory(1);
      const market = advisorBrain.getMarketState();
      const modifiers = marketRegimeDetector.getParameterModifiers(market.regime as any);

      const pnlIcon = trades.pnl >= 0 ? "🟢" : "🔴";
      const regimeEmoji: Record<string, string> = { calm: "😌", volatile: "⚡", trending: "📈", choppy: "🌊" };
      const uptime = ((Date.now() - this.startTime) / 3600000).toFixed(1);

      const msg =
`╔══════════════════════════════════╗
║   ⏰ HOURLY ADVISOR REPORT       ║
╚══════════════════════════════════╝

${regimeEmoji[market.regime] || "📊"} *Regime:* ${this.esc(market.regime.toUpperCase())}
📉 *Volatility:* ${this.esc(market.volatility.toFixed(1))}%
⏱ *Uptime:* ${this.esc(uptime)}h

━━━━━ Last Hour Performance ━━━━━

${pnlIcon} *P&L:* $${this.esc(trades.pnl.toFixed(4))}
📊 *Trades:* ${trades.totalTrades}
🎯 *Win Rate:* ${this.esc((trades.winRate * 100).toFixed(0))}%
📈 *Best:* ${this.esc(trades.bestStrategy)}

━━━━━ Parameter Guidance ━━━━━━

  Threshold: x${this.esc(String(modifiers.profitThresholdMultiplier))}
  Size: x${this.esc(String(modifiers.tradeSizeMultiplier))}
  Speed: x${this.esc(String(modifiers.scanIntervalMultiplier))}`;

      await this.bot.sendMessage({ chat_id: this.chatId, text: msg, parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error("[TradingAdvisor] Hourly report error", err);
    }
  }

  /** Deep analysis every 6 hours — rule-based, zero cost */
  async sendDeepReport(): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      await advisorBrain.saveSnapshot("daily");
      const trades = await advisorBrain.analyzeTradeHistory(6);
      const market = advisorBrain.getMarketState();
      const evo = await advisorBrain.getEvolutionInsights();
      const recommendations = await advisorBrain.generateRecommendations(6);
      const trend = await advisorBrain.getPerformanceTrend("hourly", 6);

      const pnlIcon = trades.pnl >= 0 ? "🟢" : "🔴";

      // Build strategy breakdown
      let stratLines = "";
      for (const [name, data] of Object.entries(trades.strategyBreakdown)) {
        const icon = data.pnl >= 0 ? "🟢" : "🔴";
        stratLines += `  ${icon} ${this.esc(name)}: ${data.trades} trades \\| $${this.esc(data.pnl.toFixed(2))} \\| WR: ${this.esc((data.winRate * 100).toFixed(0))}%\n`;
      }
      if (!stratLines) stratLines = "  No strategy data yet\n";

      // Build evolution section
      let evoLines = "";
      if (evo.totalGenerations > 0) {
        evoLines = `🧬 Gen: ${evo.totalGenerations} \\| Best: ${this.esc(evo.bestStrategy)} \\| Fit: ${this.esc(evo.bestFitness.toFixed(3))} \\| ${evo.improving ? "📈 Improving" : "📉 Stagnating"}`;
      } else {
        evoLines = "  Evolution not running";
      }

      // Build recommendations
      let recLines = "";
      for (let i = 0; i < Math.min(5, recommendations.length); i++) {
        recLines += `${i + 1}\\. ${this.esc(recommendations[i])}\n\n`;
      }

      // Build trend sparkline (last 6 hourly snapshots)
      let trendLine = "";
      if (trend.length > 0) {
        trendLine = trend.reverse().map((t: any) => {
          return t.totalPnL >= 0 ? "▲" : "▼";
        }).join(" ");
      }

      const msg =
`╔══════════════════════════════════╗
║   📋 DEEP ANALYSIS REPORT        ║
╚══════════════════════════════════╝

*Period:* Last 6 hours
${pnlIcon} *Total P&L:* $${this.esc(trades.pnl.toFixed(4))}
📊 *Trades:* ${trades.totalTrades}
🎯 *Win Rate:* ${this.esc((trades.winRate * 100).toFixed(0))}%
📈 *Best Exchange:* ${this.esc(trades.bestExchangePair)}
📉 *Worst Exchange:* ${this.esc(trades.worstExchangePair)}

━━━━ Strategy Breakdown ━━━━━

${stratLines}
━━━━━━━ Evolution ━━━━━━━━

${evoLines}

━━━━━━━━ Trend ━━━━━━━━━

${this.esc(trendLine) || "Collecting data\\.\\.\\."}

━━━━ 🧠 Recommendations ━━━━

${recLines}`;

      // Split if too long
      if (msg.length > 4000) {
        const half = Math.floor(msg.length / 2);
        const splitPoint = msg.indexOf("\n", half);
        await this.bot.sendMessage({ chat_id: this.chatId, text: msg.slice(0, splitPoint), parse_mode: "MarkdownV2" });
        await this.bot.sendMessage({ chat_id: this.chatId, text: msg.slice(splitPoint), parse_mode: "MarkdownV2" });
      } else {
        await this.bot.sendMessage({ chat_id: this.chatId, text: msg, parse_mode: "MarkdownV2" });
      }

      await AdvisorReport.create({ type: "daily", content: msg, chatId: this.chatId });
    } catch (err) {
      logger.error("[TradingAdvisor] Deep report error", err);
    }
  }

  /** Send an alert — rate limited to 1 per 2 minutes */
  private async sendAlert(emoji: string, title: string, detail: string): Promise<void> {
    if (!this.bot || !this.chatId) return;
    const now = Date.now();
    if (now - this.lastAlertTime < 2 * 60 * 1000) return;
    this.lastAlertTime = now;

    const msg =
`${emoji} *ADVISOR ALERT*

*${this.esc(title)}*

${this.esc(detail)}`;

    try {
      await this.bot.sendMessage({ chat_id: this.chatId, text: msg, parse_mode: "MarkdownV2" });
      await AdvisorReport.create({ type: "alert", content: `${title}: ${detail}`, chatId: this.chatId });
    } catch (err) {
      logger.error("[TradingAdvisor] Alert error", err);
    }
  }

  getStatus(): { running: boolean; lastRegime: string; uptimeHours: number } {
    return {
      running: this.isRunning,
      lastRegime: this.lastRegime,
      uptimeHours: this.startTime > 0 ? (Date.now() - this.startTime) / 3600000 : 0,
    };
  }

  /** Manual trigger for /advisor_report */
  async triggerReport(bot: TelegramBot, chatId: number): Promise<void> {
    this.bot = bot;
    this.chatId = chatId;
    await this.sendDeepReport();
  }

  private esc(text: string): string {
    return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
  }
}

export const tradingAdvisor = new TradingAdvisor();
```

---

## TASK 4: Add Telegram Commands

**File:** Modify `src/telegram/telegram.controller.ts`

### Step 1: Add import at top

After existing imports add:
```typescript
import { tradingAdvisor } from "../ai/TradingAdvisor";
```

### Step 2: Add commands to setCommands() array

Add these entries:
```typescript
      { command: 'advisor_start', description: 'Start AI trading advisor (free)' },
      { command: 'advisor_stop', description: 'Stop AI trading advisor' },
      { command: 'advisor_report', description: 'Get instant analysis report' },
```

### Step 3: Add command routing in registerHandlers

Add after the `/ai_regime` handler:
```typescript
      // ─── Advisor Commands ───
      if(messageText === "/advisor_start"){
        await this.handleAdvisorStart(chatId);
      }
      if(messageText === "/advisor_stop"){
        await this.handleAdvisorStop(chatId);
      }
      if(messageText === "/advisor_report"){
        await this.handleAdvisorReport(chatId);
      }
```

### Step 4: Add handler methods

Add before the `escMd()` helper method:

```typescript
  // ─── Advisor Handlers ──────────────────────────────────────

  private async handleAdvisorStart(chatId: number) {
    try {
      const status = tradingAdvisor.getStatus();
      if (status.running) {
        await this.bot.sendMessage({
          chat_id: chatId,
          text: "⚠️ Advisor already running\\. Use /advisor\\_stop first\\.",
          parse_mode: "MarkdownV2",
        });
        return;
      }

      await tradingAdvisor.start(this.bot, chatId);

      const msg =
`╔══════════════════════════════════╗
║   🧠 TRADING ADVISOR STARTED     ║
╚══════════════════════════════════╝

💰 *Cost:* FREE \\(no API calls\\)
🔍 All analysis is local \\+ rule\\-based

━━━━━━━ Monitoring ━━━━━━━━

🔍 Every 5 min: regime, spreads, signals
⏰ Hourly: performance snapshot
📋 Every 6h: deep analysis \\+ recommendations

━━━━━━━━ Alerts ━━━━━━━━━━

🔄 Market regime changes
📊 Strong stat arb divergences
⚠️ Low performance warnings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 /advisor\\_report — Instant analysis
🛑 /advisor\\_stop — Stop advisor`;

      await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
    } catch (error) {
      console.error("[Telegram Controller] Advisor start error:", error);
      await this.bot.sendMessage({ chat_id: chatId, text: "❌ Error starting advisor\\.", parse_mode: "MarkdownV2" });
    }
  }

  private async handleAdvisorStop(chatId: number) {
    const status = tradingAdvisor.getStatus();
    if (!status.running) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "⚠️ Advisor is not running\\.",
        parse_mode: "MarkdownV2",
      });
      return;
    }

    tradingAdvisor.stop();

    const uptimeH = status.uptimeHours.toFixed(1);
    await this.bot.sendMessage({
      chat_id: chatId,
      text:
`╔══════════════════════════════════╗
║   🛑 TRADING ADVISOR STOPPED     ║
╚══════════════════════════════════╝

⏱ Uptime: ${this.escMd(uptimeH)} hours
Use /advisor\\_start to resume\\.`,
      parse_mode: "MarkdownV2",
    });
  }

  private async handleAdvisorReport(chatId: number) {
    await this.bot.sendMessage({
      chat_id: chatId,
      text: "⏳ Analyzing\\.\\.\\. \\(local computation, no API cost\\)",
      parse_mode: "MarkdownV2",
    });

    try {
      await tradingAdvisor.triggerReport(this.bot, chatId);
    } catch (error) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "❌ Error generating report\\.",
        parse_mode: "MarkdownV2",
      });
    }
  }
```

---

## Execution Order

1. **TASK 1** — `src/ai/advisor.model.ts` (schemas, no deps)
2. **TASK 2** — `src/ai/AdvisorBrain.ts` (depends on Task 1 + existing modules)
3. **TASK 3** — `src/ai/TradingAdvisor.ts` (depends on Task 2)
4. **TASK 4** — `src/telegram/telegram.controller.ts` (depends on Task 3)

## Rules

- **Protocol 7** (AI/ML Feature) + **Protocol 4** (Telegram Command)
- **ZERO external API calls** — no Claude API, no OpenAI, no paid services
- All analysis uses: MongoDB queries, simple-statistics, MarketRegimeDetector, CorrelationTracker
- All Telegram messages use MarkdownV2 with escMd() / esc()
- Rate-limit alerts: max 1 per 2 minutes
- Clean up all timers on stop()
- Try/catch all MongoDB queries and Telegram sends

## Verification

```bash
# Build — zero errors
npm run build

# Start
npm start

# In Telegram:
# /advisor_start   → "TRADING ADVISOR STARTED" card, says "Cost: FREE"
# Wait 5 min       → Check server logs for "[TradingAdvisor] Monitor" activity
# /advisor_report  → Deep analysis with strategy breakdown + recommendations
# /advisor_stop    → "TRADING ADVISOR STOPPED" with uptime
```
