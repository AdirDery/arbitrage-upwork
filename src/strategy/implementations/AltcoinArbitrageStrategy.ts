import {
  IStrategy, StrategyMetadata, StrategyConfig,
  Opportunity, OpportunityScore, ExecutionResult, TradeLeg
} from "../IStrategy";
import { ExchangeAdapter } from "../../arbitrage/arbitrage.types";
import { orderBooks } from "../../orderBooks/orderbooks";
import logger from "../../core/logger.service";

export interface AltcoinArbConfig extends StrategyConfig {
  exchanges: ExchangeAdapter[];
  symbols: string[];                // dynamically discovered altcoin USDT pairs
  tradeSize: number;               // USDT amount per trade (small for altcoins)
  profitThreshold: number;         // minimum USD profit
  minSpreadPct: number;            // minimum spread % to consider (e.g., 0.3%)
}

/**
 * Altcoin Arbitrage Strategy.
 *
 * Like direct arbitrage, but specifically targets low-cap altcoin pairs where
 * spreads are 1-5% between exchanges (vs 0.01-0.1% for BTC/ETH).
 *
 * Key differences from direct arb:
 * - Uses many more symbols (50+)
 * - Smaller trade sizes (matching low liquidity)
 * - Higher profit thresholds per trade (spreads are wider)
 * - Pre-filters by spread % to avoid wasting time on tight markets
 */
export class AltcoinArbitrageStrategy implements IStrategy {
  readonly metadata: StrategyMetadata;
  private config!: AltcoinArbConfig;

  constructor(id?: string) {
    this.metadata = {
      id: id || `altcoin_${Date.now()}`,
      name: "Altcoin Arbitrage",
      type: "altcoin",
      riskLevel: "high",
      description: "Cross-exchange arbitrage on low-cap altcoins with wider spreads",
    };
  }

  async initialize(config: AltcoinArbConfig): Promise<void> {
    this.config = config;
    logger.info(`[AltcoinArb] Initialized with ${config.symbols.length} symbols across ${config.exchanges.length} exchanges`);
  }

  getConfig(): AltcoinArbConfig { return { ...this.config }; }
  updateConfig(config: Partial<AltcoinArbConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async scan(): Promise<Opportunity[]> {
    const { exchanges, symbols, tradeSize, profitThreshold, minSpreadPct } = this.config;
    const opportunities: Opportunity[] = [];

    // Batch symbols into groups to avoid overwhelming APIs
    const batchSize = 5;
    for (let s = 0; s < symbols.length; s += batchSize) {
      const symbolBatch = symbols.slice(s, s + batchSize);

      for (let i = 0; i < exchanges.length; i++) {
        for (let j = 0; j < exchanges.length; j++) {
          if (i === j) continue;

          const results = await Promise.allSettled(
            symbolBatch.map(symbol =>
              this.evaluatePair(exchanges[i], exchanges[j], symbol, tradeSize, minSpreadPct)
            )
          );

          for (const result of results) {
            if (result.status === "fulfilled" && result.value && result.value.estimatedProfit >= profitThreshold) {
              opportunities.push(result.value);
            }
          }
        }
      }
    }

    if (opportunities.length > 0) {
      logger.info(`[AltcoinArb] Found ${opportunities.length} opportunities across ${symbols.length} symbols`);
    }

    return opportunities;
  }

  private async evaluatePair(
    buyEx: ExchangeAdapter, sellEx: ExchangeAdapter,
    symbol: string, sizeUSDT: number, minSpreadPct: number
  ): Promise<Opportunity | null> {
    try {
      const [buyBook, sellBook] = await Promise.all([
        buyEx.getOrderbook(symbol),
        sellEx.getOrderbook(symbol),
      ]);

      if (buyBook.asks.length === 0 || sellBook.bids.length === 0) return null;

      const bestAsk = buyBook.asks[0][0]; // lowest ask (buy price)
      const bestBid = sellBook.bids[0][0]; // highest bid (sell price)

      // Quick spread check before doing full analysis
      const spreadPct = ((bestBid - bestAsk) / bestAsk) * 100;
      if (spreadPct < minSpreadPct) return null;

      // Convert USDT size to base currency amount
      const baseCurrencySize = sizeUSDT / bestAsk;

      buyBook.asks.sort((a, b) => a[0] - b[0]);
      sellBook.bids.sort((a, b) => b[0] - a[0]);

      const buyEst = await orderBooks.avgPriceFromBook(buyBook.asks, baseCurrencySize);
      const sellEst = await orderBooks.avgPriceFromBook(sellBook.bids, baseCurrencySize);

      if (!isFinite(buyEst.avgPrice) || !isFinite(sellEst.avgPrice)) return null;

      const [buyFees, sellFees] = await Promise.all([buyEx.getFees(symbol), sellEx.getFees(symbol)]);
      const { netProfit, roi, cost, proceeds } = await orderBooks.calculateProfit(
        buyEst.avgPrice, sellEst.avgPrice, baseCurrencySize, buyFees.taker, sellFees.taker
      );

      if (netProfit <= 0) return null;

      const legs: TradeLeg[] = [
        { exchange: buyEx.name, symbol, side: "BUY", size: baseCurrencySize, expectedPrice: buyEst.avgPrice },
        { exchange: sellEx.name, symbol, side: "SELL", size: baseCurrencySize, expectedPrice: sellEst.avgPrice },
      ];

      return {
        id: `altcoin_${buyEx.name}_${sellEx.name}_${symbol}_${Date.now()}`,
        strategyId: this.metadata.id,
        timestamp: Date.now(),
        exchanges: [buyEx.name, sellEx.name],
        symbols: [symbol],
        legs,
        estimatedProfit: netProfit,
        estimatedROI: roi,
        score: {
          profitEstimate: netProfit,
          confidence: Math.min(buyEst.consumed / baseCurrencySize, sellEst.consumed / baseCurrencySize) * 0.8,
          riskScore: 0.6, // higher risk for altcoins (low liquidity)
          urgency: 0.7,
        },
        metadata: { spreadPct, cost, proceeds, sizeUSDT, baseCurrencySize },
      };
    } catch (err) {
      return null; // Skip failed pairs silently (expected for some altcoins)
    }
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityScore> {
    return opportunity.score;
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const legResults: any[] = [];

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

      legResults.push(
        { orderId: buyRes?.orderId || "unknown", exchange: buyLeg.exchange, symbol: buyLeg.symbol, side: "BUY" as const, requestedSize: buyLeg.size, filledSize: Number(buyRes?.amount) || buyLeg.size, avgPrice: Number(buyRes?.price) || 0, fee: 0, status: (buyRes?.status === "SUCCESS" ? "SUCCESS" : "FAILED") as any },
        { orderId: sellRes?.orderId || "unknown", exchange: sellLeg.exchange, symbol: sellLeg.symbol, side: "SELL" as const, requestedSize: sellLeg.size, filledSize: Number(sellRes?.amount) || sellLeg.size, avgPrice: Number(sellRes?.price) || 0, fee: 0, status: (sellRes?.status === "SUCCESS" ? "SUCCESS" : "FAILED") as any },
      );

      const allSuccess = legResults.every((l: any) => l.status === "SUCCESS");

      return {
        success: allSuccess, opportunityId: opportunity.id, legs: legResults,
        actualProfit: allSuccess ? opportunity.estimatedProfit : 0,
        actualROI: allSuccess ? opportunity.estimatedROI : 0,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return { success: false, opportunityId: opportunity.id, legs: legResults, actualProfit: 0, actualROI: 0, executionTimeMs: Date.now() - startTime, error: err.message };
    }
  }

  async dispose(): Promise<void> {}
}

/**
 * Discover common altcoin USDT pairs across exchanges.
 * Returns symbols listed on 2+ exchanges.
 */
export const ALTCOIN_SYMBOLS = [
  // Mid-cap (likely on most exchanges)
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "MATICUSDT", "SHIBUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT",
  "NEARUSDT", "APTUSDT", "ARUSDT", "FILUSDT", "ICPUSDT",
  "XRPUSDT", "TRXUSDT", "TONUSDT", "SUIUSDT", "SEIUSDT",
  // Lower-cap (wider spreads, fewer exchanges)
  "OPUSDT", "ARBUSDT", "INJUSDT", "TIAUSDT", "STXUSDT",
  "RUNEUSDT", "FTMUSDT", "GRTUSDT", "AAVEUSDT", "MKRUSDT",
  "SNXUSDT", "COMPUSDT", "LDOUSDT", "RNDRUSDT", "WLDUSDT",
  "PENDLEUSDT", "JUPUSDT", "WUSDT", "ENSUSDT", "CFXUSDT",
  "APEUSDT", "GALAUSDT", "MANAUSDT", "SANDUSDT", "AXSUSDT",
  "CHZUSDT", "CRVUSDT", "1INCHUSDT", "DYDXUSDT", "GMXUSDT",
];
