import {
  IStrategy, StrategyMetadata, StrategyConfig,
  Opportunity, OpportunityScore, ExecutionResult, TradeLeg, LegResult
} from "../IStrategy";
import { ExchangeAdapter } from "../../arbitrage/arbitrage.types";
import { orderBooks } from "../../orderBooks/orderbooks";
import logger from "../../core/logger.service";

export interface DirectArbConfig extends StrategyConfig {
  exchanges: ExchangeAdapter[];
  symbols: string[];
  tradeSize: number;
  profitThreshold: number; // minimum USD profit to consider
}

/**
 * Direct arbitrage: buy on Exchange A, sell on Exchange B.
 * Wraps the existing evaluation logic into the IStrategy interface.
 */
export class DirectArbitrageStrategy implements IStrategy {
  readonly metadata: StrategyMetadata;
  private config!: DirectArbConfig;

  constructor(id?: string) {
    this.metadata = {
      id: id || `direct_${Date.now()}`,
      name: "Direct Arbitrage",
      type: "direct",
      riskLevel: "medium",
      description: "Buy on one exchange, sell on another for the same symbol",
    };
  }

  async initialize(config: DirectArbConfig): Promise<void> {
    this.config = config;
  }

  getConfig(): DirectArbConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<DirectArbConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Scan all exchange pairs for all symbols, return profitable opportunities.
   */
  async scan(): Promise<Opportunity[]> {
    const { exchanges, symbols, tradeSize, profitThreshold } = this.config;
    const opportunities: Opportunity[] = [];

    for (let i = 0; i < exchanges.length; i++) {
      for (let j = 0; j < exchanges.length; j++) {
        if (i === j) continue;

        const buyEx = exchanges[i];
        const sellEx = exchanges[j];

        // Evaluate all symbols for this exchange pair in parallel
        const results = await Promise.allSettled(
          symbols.map(symbol => this.evaluatePair(buyEx, sellEx, symbol, tradeSize))
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value && result.value.estimatedProfit >= profitThreshold) {
            opportunities.push(result.value);
          }
        }
      }
    }

    return opportunities;
  }

  private async evaluatePair(
    buyEx: ExchangeAdapter, sellEx: ExchangeAdapter,
    symbol: string, size: number
  ): Promise<Opportunity | null> {
    try {
      const [buyBook, sellBook] = await Promise.all([
        buyEx.getOrderbook(symbol),
        sellEx.getOrderbook(symbol),
      ]);

      buyBook.asks.sort((a, b) => a[0] - b[0]);
      sellBook.bids.sort((a, b) => b[0] - a[0]);

      const buyEst = await orderBooks.avgPriceFromBook(buyBook.asks, size);
      const sellEst = await orderBooks.avgPriceFromBook(sellBook.bids, size);

      if (!isFinite(buyEst.avgPrice) || !isFinite(sellEst.avgPrice)) return null;

      const [buyFees, sellFees] = await Promise.all([buyEx.getFees(symbol), sellEx.getFees(symbol)]);
      const { netProfit, roi, cost, proceeds } = await orderBooks.calculateProfit(
        buyEst.avgPrice, sellEst.avgPrice, size, buyFees.taker, sellFees.taker
      );

      if (netProfit <= 0) return null;

      const legs: TradeLeg[] = [
        { exchange: buyEx.name, symbol, side: "BUY", size, expectedPrice: buyEst.avgPrice },
        { exchange: sellEx.name, symbol, side: "SELL", size, expectedPrice: sellEst.avgPrice },
      ];

      return {
        id: `direct_${buyEx.name}_${sellEx.name}_${symbol}_${Date.now()}`,
        strategyId: this.metadata.id,
        timestamp: Date.now(),
        exchanges: [buyEx.name, sellEx.name],
        symbols: [symbol],
        legs,
        estimatedProfit: netProfit,
        estimatedROI: roi,
        score: {
          profitEstimate: netProfit,
          confidence: Math.min(buyEst.consumed / size, sellEst.consumed / size),
          riskScore: 0.3, // direct arb is relatively low risk
          urgency: 0.8,   // prices change fast
        },
        metadata: { cost, proceeds, buyExchange: buyEx.name, sellExchange: sellEx.name },
      };
    } catch (err) {
      logger.error(`[DirectArbStrategy] Error evaluating ${buyEx.name}->${sellEx.name} ${symbol}`, err);
      return null;
    }
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityScore> {
    return opportunity.score;
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const legResults: LegResult[] = [];

    try {
      const buyLeg = opportunity.legs[0];
      const sellLeg = opportunity.legs[1];

      const buyEx = this.config.exchanges.find(e => e.name === buyLeg.exchange)!;
      const sellEx = this.config.exchanges.find(e => e.name === sellLeg.exchange)!;

      // Execute both legs in parallel
      const [buyRes, sellRes] = await Promise.all([
        buyEx.marketBuy(buyLeg.symbol, buyLeg.size),
        sellEx.marketSell(sellLeg.symbol, sellLeg.size),
      ]);

      legResults.push({
        orderId: buyRes?.orderId || "unknown",
        exchange: buyLeg.exchange,
        symbol: buyLeg.symbol,
        side: "BUY",
        requestedSize: buyLeg.size,
        filledSize: Number(buyRes?.amount) || buyLeg.size,
        avgPrice: Number(buyRes?.price) || buyLeg.expectedPrice,
        fee: 0,
        status: buyRes?.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      });

      legResults.push({
        orderId: sellRes?.orderId || "unknown",
        exchange: sellLeg.exchange,
        symbol: sellLeg.symbol,
        side: "SELL",
        requestedSize: sellLeg.size,
        filledSize: Number(sellRes?.amount) || sellLeg.size,
        avgPrice: Number(sellRes?.price) || sellLeg.expectedPrice,
        fee: 0,
        status: sellRes?.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      });

      const allSuccess = legResults.every(l => l.status === "SUCCESS");

      return {
        success: allSuccess,
        opportunityId: opportunity.id,
        legs: legResults,
        actualProfit: allSuccess ? opportunity.estimatedProfit : 0,
        actualROI: allSuccess ? opportunity.estimatedROI : 0,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        opportunityId: opportunity.id,
        legs: legResults,
        actualProfit: 0,
        actualROI: 0,
        executionTimeMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up
  }
}
