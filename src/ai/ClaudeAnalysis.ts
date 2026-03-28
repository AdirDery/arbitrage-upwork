import Anthropic from "@anthropic-ai/sdk";
import { Transaction } from "../transactions/transaction.model";
import { GenerationRecord } from "../evolution/evolution.model";
import logger from "../core/logger.service";

/**
 * Uses Claude API to generate daily trading analysis reports.
 * Sends summaries of opportunities, trades, P&L, and brain performance
 * to Claude for strategic analysis and parameter recommendations.
 */
export class ClaudeAnalysis {
  private client: Anthropic | null = null;

  constructor(private apiKey?: string) {
    const key = apiKey || process.env.CLAUDE_API_KEY;
    if (key) {
      this.client = new Anthropic({ apiKey: key });
    }
  }

  /**
   * Generate a daily analysis report from trading data.
   * Returns a formatted string suitable for Telegram.
   */
  async generateDailyReport(): Promise<string> {
    if (!this.client) {
      return "Claude API key not configured. Set CLAUDE_API_KEY in .env";
    }

    try {
      const summary = await this.gatherDailySummary();

      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `You are a crypto arbitrage trading analyst. Analyze this daily trading summary and provide:
1. Performance assessment (2-3 sentences)
2. Key observations about which exchanges/pairs performed best
3. Specific parameter adjustment recommendations
4. Risk warnings if any

Keep your response concise (under 500 words), formatted for a Telegram message.

Daily Trading Summary:
${JSON.stringify(summary, null, 2)}`
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "No analysis available";
      return text;
    } catch (err: any) {
      logger.error("[ClaudeAnalysis] Error generating report", err);
      return `Analysis error: ${err.message}`;
    }
  }

  /**
   * Analyze a specific opportunity and provide a recommendation.
   */
  async analyzeOpportunity(opportunityData: any): Promise<string> {
    if (!this.client) return "Claude API not configured";

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: `Quick analysis of this crypto arbitrage opportunity. Should we trade it? Consider spread size, liquidity, and risk.

Opportunity: ${JSON.stringify(opportunityData)}

Reply in 2-3 sentences.`
        }],
      });

      return response.content[0].type === "text" ? response.content[0].text : "No analysis";
    } catch (err: any) {
      return `Analysis error: ${err.message}`;
    }
  }

  /**
   * Get parameter adjustment suggestions based on evolution data.
   */
  async suggestParameterAdjustments(evolutionData: any): Promise<string> {
    if (!this.client) return "Claude API not configured";

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `You are optimizing a genetic algorithm for crypto arbitrage. Based on this evolution data, suggest specific parameter adjustments for the next generation.

Evolution Data:
${JSON.stringify(evolutionData, null, 2)}

Provide 3-5 specific, actionable recommendations.`
        }],
      });

      return response.content[0].type === "text" ? response.content[0].text : "No suggestions";
    } catch (err: any) {
      return `Suggestion error: ${err.message}`;
    }
  }

  private async gatherDailySummary() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get today's transactions
    const transactions = await Transaction.find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 }).limit(100);

    const liveTrades = transactions.filter((t: any) => t.mode !== "paper");
    const paperTrades = transactions.filter((t: any) => t.mode === "paper");

    // Get evolution data
    const generations = await GenerationRecord.find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 }).limit(5);

    // Count by exchange
    const exchangeCounts: Record<string, number> = {};
    for (const tx of transactions) {
      const ex = (tx as any).exchange || "unknown";
      exchangeCounts[ex] = (exchangeCounts[ex] || 0) + 1;
    }

    // Count by status
    const successCount = transactions.filter((t: any) => t.status === "SUCCESS").length;
    const failedCount = transactions.filter((t: any) => t.status === "FAILED").length;

    return {
      period: "Last 24 hours",
      totalTransactions: transactions.length,
      liveTradeCount: liveTrades.length,
      paperTradeCount: paperTrades.length,
      successCount,
      failedCount,
      exchangeDistribution: exchangeCounts,
      evolutionGenerations: generations.map((g: any) => ({
        generation: g.generation,
        bestFitness: g.bestFitness,
        avgFitness: g.avgFitness,
      })),
    };
  }
}
