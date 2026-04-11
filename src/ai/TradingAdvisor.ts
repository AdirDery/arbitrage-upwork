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
 * Schedule:
 * - Every 5 min: regime changes, correlation signals, performance anomalies
 * - Hourly: performance snapshot + parameter guidance
 * - Every 6 hours: deep analysis with strategy recommendations
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

      // Strategy breakdown
      let stratLines = "";
      for (const [name, data] of Object.entries(trades.strategyBreakdown)) {
        const icon = data.pnl >= 0 ? "🟢" : "🔴";
        stratLines += `  ${icon} ${this.esc(name)}: ${data.trades} trades \\| $${this.esc(data.pnl.toFixed(2))} \\| WR: ${this.esc((data.winRate * 100).toFixed(0))}%\n`;
      }
      if (!stratLines) stratLines = "  No strategy data yet\n";

      // Evolution
      let evoLines = "";
      if (evo.totalGenerations > 0) {
        evoLines = `🧬 Gen: ${evo.totalGenerations} \\| Best: ${this.esc(evo.bestStrategy)} \\| Fit: ${this.esc(evo.bestFitness.toFixed(3))} \\| ${evo.improving ? "📈 Improving" : "📉 Stagnating"}`;
      } else {
        evoLines = "  Evolution not running";
      }

      // Recommendations
      let recLines = "";
      for (let i = 0; i < Math.min(5, recommendations.length); i++) {
        recLines += `${i + 1}\\. ${this.esc(recommendations[i])}\n\n`;
      }

      // Trend sparkline
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

      // Split if too long for Telegram
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
