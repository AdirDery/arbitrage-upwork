import { TelegramBot } from "typescript-telegram-bot-api";
import { riskBrain } from "./RiskBrain";
import logger from "../core/logger.service";

/**
 * Risk Manager — the guardian that sits between strategies and execution.
 * Every trade must pass through checkTrade() before execution.
 * Zero API cost — all rule-based.
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

  /** PRE-TRADE CHECK — call before every trade */
  async checkTrade(tradeSizeUSD: number): Promise<{ allowed: boolean; reason: string }> {
    const result = await riskBrain.checkTradeAllowed(tradeSizeUSD);

    if (!result.allowed) {
      logger.warn(`[RiskManager] Trade BLOCKED: ${result.reason}`);
      await this.sendAlertIfNeeded("🚫", "Trade Blocked", result.reason);
    }

    return result;
  }

  /** POST-TRADE RECORD — call after every trade */
  async recordTrade(profit: number, strategyId: string, exchangePair: string): Promise<void> {
    await riskBrain.recordTrade(profit, strategyId, exchangePair);

    const status = riskBrain.getStatus();

    // Circuit breaker triggered
    if (status.isHalted) {
      await this.sendAlert("🛑", "CIRCUIT BREAKER TRIGGERED", status.haltReason);
    }

    // Losing streak warning
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

  private async monitorCycle(): Promise<void> {
    if (!this.isRunning) return;
    try {
      const status = riskBrain.getStatus();
      if (status.isHalted) {
        logger.info(`[RiskManager] Trading halted: ${status.haltReason}`);
      }
    } catch (err) {
      logger.error("[RiskManager] Monitor error", err);
    }
  }

  /** Risk report every 4 hours */
  async sendRiskReport(): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const status = riskBrain.getStatus();
      const config = await riskBrain.getConfig();
      const weekly = await riskBrain.getWeeklySummary();
      const recs = await riskBrain.generateRecommendations();

      const pnlIcon = status.dailyPnL >= 0 ? "🟢" : "🔴";
      const haltIcon = status.isHalted ? "🛑 HALTED" : "✅ Active";

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

  private async sendAlertIfNeeded(emoji: string, title: string, detail: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTime < 3 * 60 * 1000) return;
    this.lastAlertTime = now;
    await this.sendAlert(emoji, title, detail);
  }

  async triggerReport(bot: TelegramBot, chatId: number): Promise<void> {
    this.bot = bot;
    this.chatId = chatId;
    await riskBrain.initialize();
    await this.sendRiskReport();
  }

  getStatus(): { running: boolean; halted: boolean; haltReason: string } {
    const brainStatus = riskBrain.getStatus();
    return { running: this.isRunning, halted: brainStatus.isHalted, haltReason: brainStatus.haltReason };
  }

  private esc(text: string): string {
    return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
  }
}

export const riskManager = new RiskManager();
