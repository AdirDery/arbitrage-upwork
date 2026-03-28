import * as ss from "simple-statistics";
import { OrderbookManager } from "../orderBooks/orderbookManager";
import logger from "../core/logger.service";

interface PricePoint {
  timestamp: number;
  price: number;
}

export interface PairDivergence {
  pair: [string, string];       // e.g., ["ETHUSDT", "BTCUSDT"]
  ratio: number;                // current price ratio
  meanRatio: number;            // historical mean ratio
  zScore: number;               // standard deviations from mean
  correlation: number;          // rolling correlation
  signal: "BUY_A_SELL_B" | "SELL_A_BUY_B" | "NEUTRAL";
}

/**
 * Tracks price correlations and mean-reversion signals between asset pairs.
 * Used by StatisticalArbitrageStrategy to find divergence opportunities.
 *
 * When two correlated assets diverge significantly (z-score > threshold),
 * trade the convergence: buy the underperformer, sell the outperformer.
 */
export class CorrelationTracker {
  private priceHistory: Map<string, PricePoint[]> = new Map();
  private readonly maxHistory = 500;  // ~83 minutes at 10s intervals
  private readonly pairs: [string, string][] = [
    ["ETHUSDT", "BTCUSDT"],
    ["SOLUSDT", "ETHUSDT"],
    ["SOLUSDT", "BTCUSDT"],
  ];

  /** Record current mid-prices for tracked symbols */
  recordPrices(exchange: string = "Binance"): void {
    const symbols = new Set(this.pairs.flat());

    for (const symbol of symbols) {
      const book = OrderbookManager.getOrderbook(exchange, symbol);
      if (book.timestamp === 0 || book.bids.length === 0 || book.asks.length === 0) continue;

      const midPrice = (book.bids[0][0] + book.asks[0][0]) / 2;

      if (!this.priceHistory.has(symbol)) {
        this.priceHistory.set(symbol, []);
      }

      const history = this.priceHistory.get(symbol)!;
      history.push({ timestamp: Date.now(), price: midPrice });

      // Trim
      if (history.length > this.maxHistory) {
        this.priceHistory.set(symbol, history.slice(-this.maxHistory));
      }
    }
  }

  /** Analyze all tracked pairs for divergence signals */
  analyzePairs(): PairDivergence[] {
    const results: PairDivergence[] = [];

    for (const pair of this.pairs) {
      const [symbolA, symbolB] = pair;
      const historyA = this.priceHistory.get(symbolA);
      const historyB = this.priceHistory.get(symbolB);

      if (!historyA || !historyB || historyA.length < 30 || historyB.length < 30) continue;

      // Align timestamps (use last N where both have data)
      const minLen = Math.min(historyA.length, historyB.length);
      const pricesA = historyA.slice(-minLen).map(p => p.price);
      const pricesB = historyB.slice(-minLen).map(p => p.price);

      // Calculate price ratio over time
      const ratios = pricesA.map((a, i) => a / pricesB[i]);
      const currentRatio = ratios[ratios.length - 1];
      const meanRatio = ss.mean(ratios);
      const stdRatio = ss.standardDeviation(ratios);
      const zScore = stdRatio > 0 ? (currentRatio - meanRatio) / stdRatio : 0;

      // Rolling correlation
      const correlation = ss.sampleCorrelation(pricesA, pricesB);

      // Signal: only trade if correlation is high (>0.7) and z-score is extreme (>2)
      let signal: PairDivergence["signal"] = "NEUTRAL";
      if (correlation > 0.7) {
        if (zScore > 2) {
          // A is overpriced relative to B → sell A, buy B
          signal = "SELL_A_BUY_B";
        } else if (zScore < -2) {
          // A is underpriced relative to B → buy A, sell B
          signal = "BUY_A_SELL_B";
        }
      }

      results.push({ pair, ratio: currentRatio, meanRatio, zScore, correlation, signal });
    }

    return results;
  }

  /** Get the number of recorded data points for a symbol */
  getDataPoints(symbol: string): number {
    return this.priceHistory.get(symbol)?.length || 0;
  }
}

export const correlationTracker = new CorrelationTracker();
