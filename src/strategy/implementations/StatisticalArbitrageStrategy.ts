import {
  IStrategy, StrategyMetadata, StrategyConfig,
  Opportunity, OpportunityScore, ExecutionResult, TradeLeg
} from "../IStrategy";
import { ExchangeAdapter } from "../../arbitrage/arbitrage.types";
import { correlationTracker, PairDivergence } from "../../ai/CorrelationTracker";
import logger from "../../core/logger.service";

export interface StatArbConfig extends StrategyConfig {
  exchanges: ExchangeAdapter[];
  tradeSize: number;               // USDT per leg
  zScoreThreshold: number;         // min z-score to trigger (default 2.0)
  minCorrelation: number;          // min correlation to consider (default 0.7)
  exchange: string;                // which exchange to trade on (same exchange for both legs)
}

/**
 * Statistical Arbitrage (Pairs Trading).
 *
 * Monitors correlation between asset pairs (e.g., ETH/BTC ratio).
 * When the ratio diverges > N standard deviations from the mean:
 * - Buy the underperformer
 * - Sell the outperformer
 * - Profit when they converge back to the mean
 *
 * This is market-neutral and works in any market direction.
 */
export class StatisticalArbitrageStrategy implements IStrategy {
  readonly metadata: StrategyMetadata;
  private config!: StatArbConfig;

  constructor(id?: string) {
    this.metadata = {
      id: id || `statarb_${Date.now()}`,
      name: "Statistical Arbitrage",
      type: "statistical",
      riskLevel: "medium",
      description: "Mean-reversion pairs trading on correlated crypto assets",
    };
  }

  async initialize(config: StatArbConfig): Promise<void> {
    this.config = config;
  }

  getConfig(): StatArbConfig { return { ...this.config }; }
  updateConfig(config: Partial<StatArbConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async scan(): Promise<Opportunity[]> {
    // Record latest prices for correlation tracking
    correlationTracker.recordPrices(this.config.exchange);

    // Analyze all pairs
    const divergences = correlationTracker.analyzePairs();
    const opportunities: Opportunity[] = [];

    for (const div of divergences) {
      if (div.signal === "NEUTRAL") continue;
      if (Math.abs(div.zScore) < this.config.zScoreThreshold) continue;
      if (div.correlation < this.config.minCorrelation) continue;

      const [symbolA, symbolB] = div.pair;
      const exchange = this.config.exchange;

      let legs: TradeLeg[];
      if (div.signal === "BUY_A_SELL_B") {
        legs = [
          { exchange, symbol: symbolA, side: "BUY", size: this.config.tradeSize, expectedPrice: 0 },
          { exchange, symbol: symbolB, side: "SELL", size: this.config.tradeSize, expectedPrice: 0 },
        ];
      } else {
        legs = [
          { exchange, symbol: symbolA, side: "SELL", size: this.config.tradeSize, expectedPrice: 0 },
          { exchange, symbol: symbolB, side: "BUY", size: this.config.tradeSize, expectedPrice: 0 },
        ];
      }

      // Estimated profit: assumes convergence to mean (z-score returns to 0)
      // Very rough: profit ≈ |z-score| * stdDev * tradeSize
      const estimatedProfit = Math.abs(div.zScore) * 0.001 * this.config.tradeSize;

      opportunities.push({
        id: `statarb_${symbolA}_${symbolB}_${Date.now()}`,
        strategyId: this.metadata.id,
        timestamp: Date.now(),
        exchanges: [exchange],
        symbols: [symbolA, symbolB],
        legs,
        estimatedProfit,
        estimatedROI: estimatedProfit / (this.config.tradeSize * 2),
        score: {
          profitEstimate: estimatedProfit,
          confidence: div.correlation,
          riskScore: 0.4,
          urgency: 0.4,
        },
        metadata: {
          zScore: div.zScore,
          correlation: div.correlation,
          ratio: div.ratio,
          meanRatio: div.meanRatio,
          signal: div.signal,
        },
      });

      logger.info(
        `[StatArb] Signal: ${div.signal} | ${symbolA}/${symbolB} | ` +
        `Z-Score: ${div.zScore.toFixed(2)} | Corr: ${div.correlation.toFixed(3)}`
      );
    }

    return opportunities;
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityScore> {
    return opportunity.score;
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const exchange = this.config.exchanges.find(e => e.name === this.config.exchange);
    if (!exchange) {
      return { success: false, opportunityId: opportunity.id, legs: [], actualProfit: 0, actualROI: 0, executionTimeMs: 0, error: "Exchange not found" };
    }

    const results = await Promise.allSettled(
      opportunity.legs.map(leg =>
        leg.side === "BUY"
          ? exchange.marketBuy(leg.symbol, leg.size)
          : exchange.marketSell(leg.symbol, leg.size)
      )
    );

    const legResults = results.map((r, i) => {
      const leg = opportunity.legs[i];
      const res = r.status === "fulfilled" ? r.value : null;
      return {
        orderId: res?.orderId || "failed",
        exchange: leg.exchange,
        symbol: leg.symbol,
        side: leg.side,
        requestedSize: leg.size,
        filledSize: Number(res?.amount) || 0,
        avgPrice: Number(res?.price) || 0,
        fee: 0,
        status: (res?.status === "SUCCESS" ? "SUCCESS" : "FAILED") as any,
      };
    });

    return {
      success: legResults.every(l => l.status === "SUCCESS"),
      opportunityId: opportunity.id,
      legs: legResults,
      actualProfit: opportunity.estimatedProfit,
      actualROI: opportunity.estimatedROI,
      executionTimeMs: Date.now() - startTime,
    };
  }

  async dispose(): Promise<void> {}
}
