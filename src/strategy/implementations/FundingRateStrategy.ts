import {
  IStrategy, StrategyMetadata, StrategyConfig,
  Opportunity, OpportunityScore, ExecutionResult, TradeLeg, LegResult
} from "../IStrategy";
import { IFuturesAdapter, FundingRateInfo } from "../../adapters/futures/IFuturesAdapter";
import { ExchangeAdapter } from "../../arbitrage/arbitrage.types";
import logger from "../../core/logger.service";

export interface FundingRateConfig extends StrategyConfig {
  spotAdapters: Record<string, ExchangeAdapter>;
  futuresAdapters: Record<string, IFuturesAdapter>;
  symbols: string[];                // e.g., ["BTCUSDT", "ETHUSDT"]
  minFundingRate: number;           // minimum funding rate to enter (e.g., 0.0003 = 0.03%)
  capitalPerPosition: number;       // USDT per position (split 50/50 spot+futures)
  maxPositions: number;             // max concurrent funding rate positions
  closeAfterReversals: number;      // close after N consecutive negative funding cycles
}

interface ActivePosition {
  symbol: string;
  spotExchange: string;
  futuresExchange: string;
  entryFundingRate: number;
  entryTime: number;
  spotSize: number;
  futuresSize: number;
  totalFundingCollected: number;
  consecutiveReversals: number;
}

/**
 * Funding Rate Arbitrage Strategy.
 *
 * When perpetual futures funding rate is positive and above threshold:
 * 1. Buy spot on a CEX (go long the asset)
 * 2. Short perpetual futures on the same or different exchange
 * 3. Collect funding payments every 8 hours
 * 4. Close both positions when rate reverses for N consecutive cycles
 *
 * This is delta-neutral: spot long cancels futures short.
 * Profit comes purely from funding rate payments.
 * Expected annual return: 12-25%.
 */
export class FundingRateStrategy implements IStrategy {
  readonly metadata: StrategyMetadata;
  private config!: FundingRateConfig;
  private activePositions: Map<string, ActivePosition> = new Map();

  constructor(id?: string) {
    this.metadata = {
      id: id || `funding_${Date.now()}`,
      name: "Funding Rate Arbitrage",
      type: "funding",
      riskLevel: "low",
      description: "Delta-neutral funding rate collection: long spot + short perps",
    };
  }

  async initialize(config: FundingRateConfig): Promise<void> {
    this.config = config;
  }

  getConfig(): FundingRateConfig { return { ...this.config }; }
  updateConfig(config: Partial<FundingRateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Scan for funding rate opportunities.
   * Returns opportunities where funding rate is above threshold.
   */
  async scan(): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];
    const { futuresAdapters, symbols, minFundingRate, capitalPerPosition, maxPositions } = this.config;

    // Skip if we're at max positions
    if (this.activePositions.size >= maxPositions) return [];

    for (const [exchangeName, futuresAdapter] of Object.entries(futuresAdapters)) {
      for (const symbol of symbols) {
        // Skip if already have a position for this symbol
        if (this.activePositions.has(symbol)) continue;

        try {
          const fundingInfo = await futuresAdapter.getFundingRate(symbol);

          if (fundingInfo.currentRate >= minFundingRate) {
            // Positive funding = shorts pay longs. We want to short futures + long spot.
            // Actually: positive funding = longs pay shorts. So we SHORT futures to collect.
            const annualizedRate = fundingInfo.currentRate * 3 * 365 * 100; // 3 times/day * 365 days

            const spotExchange = this.findBestSpotExchange(symbol);
            if (!spotExchange) continue;

            const legs: TradeLeg[] = [
              { exchange: spotExchange, symbol, side: "BUY", size: capitalPerPosition / 2, expectedPrice: 0 },
              { exchange: exchangeName, symbol, side: "SELL", size: capitalPerPosition / 2, expectedPrice: 0 },
            ];

            opportunities.push({
              id: `funding_${exchangeName}_${symbol}_${Date.now()}`,
              strategyId: this.metadata.id,
              timestamp: Date.now(),
              exchanges: [spotExchange, exchangeName],
              symbols: [symbol],
              legs,
              estimatedProfit: fundingInfo.currentRate * capitalPerPosition, // per 8h cycle
              estimatedROI: fundingInfo.currentRate,
              score: {
                profitEstimate: fundingInfo.currentRate * capitalPerPosition,
                confidence: 0.8,
                riskScore: 0.2, // low risk — delta neutral
                urgency: 0.3,   // no rush — funding collected every 8h
              },
              metadata: {
                fundingRate: fundingInfo.currentRate,
                annualizedRate,
                nextFundingTime: fundingInfo.nextFundingTime,
                futuresExchange: exchangeName,
                spotExchange,
              },
            });

            logger.info(
              `[FundingRate] Opportunity: ${symbol} on ${exchangeName} | ` +
              `Rate: ${(fundingInfo.currentRate * 100).toFixed(4)}% | ` +
              `Annualized: ${annualizedRate.toFixed(1)}%`
            );
          }
        } catch (err) {
          // Skip failed rate lookups
        }
      }
    }

    // Also check if any active positions should be closed
    await this.checkActivePositions();

    return opportunities;
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityScore> {
    return opportunity.score;
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const { spotAdapters, futuresAdapters } = this.config;
    const legResults: LegResult[] = [];

    try {
      const spotExchange = opportunity.metadata.spotExchange;
      const futuresExchange = opportunity.metadata.futuresExchange;
      const symbol = opportunity.symbols[0];
      const size = opportunity.legs[0].size;

      const spotAdapter = spotAdapters[spotExchange];
      const futuresAdapter = futuresAdapters[futuresExchange];

      if (!spotAdapter || !futuresAdapter) {
        return this.failResult(opportunity, startTime, "Missing adapter");
      }

      // 1. Buy spot
      const spotResult = await spotAdapter.marketBuy(symbol, size);
      legResults.push({
        orderId: spotResult?.orderId || "unknown",
        exchange: spotExchange,
        symbol,
        side: "BUY",
        requestedSize: size,
        filledSize: Number(spotResult?.amount) || size,
        avgPrice: Number(spotResult?.price) || 0,
        fee: 0,
        status: spotResult?.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      });

      // 2. Short futures
      const futuresResult = await futuresAdapter.openShort(symbol, size, 1);
      legResults.push({
        orderId: futuresResult.orderId,
        exchange: futuresExchange,
        symbol,
        side: "SELL",
        requestedSize: size,
        filledSize: futuresResult.size,
        avgPrice: futuresResult.avgPrice,
        fee: 0,
        status: futuresResult.success ? "SUCCESS" : "FAILED",
      });

      const allSuccess = legResults.every(l => l.status === "SUCCESS");

      if (allSuccess) {
        // Track the active position
        this.activePositions.set(symbol, {
          symbol,
          spotExchange,
          futuresExchange,
          entryFundingRate: opportunity.metadata.fundingRate,
          entryTime: Date.now(),
          spotSize: size,
          futuresSize: size,
          totalFundingCollected: 0,
          consecutiveReversals: 0,
        });
      }

      return {
        success: allSuccess,
        opportunityId: opportunity.id,
        legs: legResults,
        actualProfit: 0, // funding collected over time, not immediately
        actualROI: 0,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return this.failResult(opportunity, startTime, err.message);
    }
  }

  /**
   * Check active positions and close if funding has reversed.
   */
  private async checkActivePositions(): Promise<void> {
    const { futuresAdapters, closeAfterReversals } = this.config;

    for (const [symbol, position] of this.activePositions) {
      const futuresAdapter = futuresAdapters[position.futuresExchange];
      if (!futuresAdapter) continue;

      try {
        const info = await futuresAdapter.getFundingRate(symbol);

        if (info.currentRate < 0) {
          // Funding reversed — longs now collect, shorts pay
          position.consecutiveReversals++;
          logger.info(
            `[FundingRate] ${symbol} rate reversed (${(info.currentRate * 100).toFixed(4)}%) | ` +
            `Reversals: ${position.consecutiveReversals}/${closeAfterReversals}`
          );

          if (position.consecutiveReversals >= closeAfterReversals) {
            await this.closePosition(symbol);
          }
        } else {
          position.consecutiveReversals = 0;
          position.totalFundingCollected += info.currentRate * position.futuresSize;
        }
      } catch (err) {
        // Skip check errors
      }
    }
  }

  private async closePosition(symbol: string): Promise<void> {
    const position = this.activePositions.get(symbol);
    if (!position) return;

    const { spotAdapters, futuresAdapters } = this.config;

    try {
      // Close futures short
      const futuresAdapter = futuresAdapters[position.futuresExchange];
      if (futuresAdapter) await futuresAdapter.closePosition(symbol);

      // Sell spot
      const spotAdapter = spotAdapters[position.spotExchange];
      if (spotAdapter) await spotAdapter.marketSell(symbol, position.spotSize);

      logger.info(
        `[FundingRate] Closed ${symbol} | Funding collected: $${position.totalFundingCollected.toFixed(4)} | ` +
        `Duration: ${((Date.now() - position.entryTime) / 3600000).toFixed(1)}h`
      );

      this.activePositions.delete(symbol);
    } catch (err) {
      logger.error(`[FundingRate] Error closing position ${symbol}`, err);
    }
  }

  async dispose(): Promise<void> {
    // Close all positions on shutdown
    for (const symbol of this.activePositions.keys()) {
      await this.closePosition(symbol);
    }
  }

  private findBestSpotExchange(symbol: string): string | null {
    const names = Object.keys(this.config.spotAdapters);
    return names.length > 0 ? names[0] : null;
  }

  private failResult(opp: Opportunity, startTime: number, error: string): ExecutionResult {
    return {
      success: false, opportunityId: opp.id, legs: [],
      actualProfit: 0, actualROI: 0,
      executionTimeMs: Date.now() - startTime, error,
    };
  }
}
