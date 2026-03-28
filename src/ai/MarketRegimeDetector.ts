import * as ss from "simple-statistics";
import { OrderbookManager } from "../orderBooks/orderbookManager";
import logger from "../core/logger.service";

export type MarketRegime = "calm" | "volatile" | "trending" | "choppy";

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;       // 0-1
  volatility: number;       // annualized vol estimate
  spreadMean: number;       // average cross-exchange spread %
  spreadStdDev: number;     // spread volatility
  recommendation: string;   // human-readable advice
}

export interface ParameterModifier {
  profitThresholdMultiplier: number;  // e.g., 1.5x in volatile markets
  tradeSizeMultiplier: number;        // e.g., 0.5x in choppy markets
  scanIntervalMultiplier: number;     // e.g., 0.5x (faster) in volatile markets
}

interface PriceSnapshot {
  symbol: string;
  exchange: string;
  midPrice: number;
  spread: number;    // bid-ask spread %
  timestamp: number;
}

/**
 * Classifies current market conditions into regimes.
 * Each regime triggers different parameter adjustments for trading strategies.
 *
 * - calm: low volatility, tight spreads → normal parameters
 * - volatile: high volatility, wide spreads → wider thresholds, faster scanning
 * - trending: sustained directional move → reduce trade size (trend may continue)
 * - choppy: high volatility but no direction → skip trading (high whipsaw risk)
 */
export class MarketRegimeDetector {
  private priceHistory: PriceSnapshot[] = [];
  private readonly maxHistory = 1000; // keep last 1000 snapshots
  private readonly symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  private readonly exchanges = ["Binance", "Bybit", "Okx", "Mexc", "Bingx"];

  /**
   * Record current prices from OrderbookManager.
   * Call this periodically (e.g., every 10 seconds).
   */
  recordSnapshot(): void {
    const now = Date.now();

    for (const symbol of this.symbols) {
      const prices: number[] = [];
      const spreads: number[] = [];

      for (const exchange of this.exchanges) {
        const book = OrderbookManager.getOrderbook(exchange, symbol);
        if (book.timestamp === 0 || book.bids.length === 0 || book.asks.length === 0) continue;

        const bestBid = book.bids[0][0];
        const bestAsk = book.asks[0][0];
        const midPrice = (bestBid + bestAsk) / 2;
        const spreadPct = ((bestAsk - bestBid) / midPrice) * 100;

        prices.push(midPrice);
        spreads.push(spreadPct);

        this.priceHistory.push({
          symbol,
          exchange,
          midPrice,
          spread: spreadPct,
          timestamp: now,
        });
      }
    }

    // Trim history
    if (this.priceHistory.length > this.maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this.maxHistory);
    }
  }

  /**
   * Detect the current market regime based on recent price/spread data.
   */
  detectRegime(): RegimeAnalysis {
    if (this.priceHistory.length < 20) {
      return {
        regime: "calm",
        confidence: 0.3,
        volatility: 0,
        spreadMean: 0,
        spreadStdDev: 0,
        recommendation: "Insufficient data. Collecting snapshots...",
      };
    }

    // Use last 5 minutes of data
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recent = this.priceHistory.filter(p => p.timestamp > fiveMinAgo);

    if (recent.length < 10) {
      return this.defaultAnalysis();
    }

    // Calculate spread statistics
    const spreads = recent.map(p => p.spread);
    const spreadMean = ss.mean(spreads);
    const spreadStdDev = ss.standardDeviation(spreads);

    // Calculate price volatility for BTC (as market proxy)
    const btcPrices = recent
      .filter(p => p.symbol === "BTCUSDT")
      .map(p => p.midPrice);

    let volatility = 0;
    if (btcPrices.length >= 5) {
      // Calculate returns
      const returns: number[] = [];
      for (let i = 1; i < btcPrices.length; i++) {
        returns.push((btcPrices[i] - btcPrices[i - 1]) / btcPrices[i - 1]);
      }
      const returnStdDev = ss.standardDeviation(returns);
      // Annualize (assuming ~10s intervals, ~8640 per day, ~252 trading days)
      volatility = returnStdDev * Math.sqrt(8640 * 252) * 100;
    }

    // Calculate trend (linear regression slope on BTC prices)
    let trendStrength = 0;
    if (btcPrices.length >= 5) {
      const indexed = btcPrices.map((p, i) => [i, p] as [number, number]);
      const regression = ss.linearRegression(indexed);
      const meanPrice = ss.mean(btcPrices);
      // Normalize slope as % per sample
      trendStrength = Math.abs((regression.m / meanPrice) * 100);
    }

    // Classify regime
    const regime = this.classifyRegime(volatility, spreadMean, spreadStdDev, trendStrength);

    return {
      regime: regime.regime,
      confidence: regime.confidence,
      volatility,
      spreadMean,
      spreadStdDev,
      recommendation: this.getRecommendation(regime.regime),
    };
  }

  /**
   * Get parameter modifiers for a given regime.
   * Strategies should multiply their base parameters by these values.
   */
  getParameterModifiers(regime: MarketRegime): ParameterModifier {
    switch (regime) {
      case "calm":
        return { profitThresholdMultiplier: 1.0, tradeSizeMultiplier: 1.0, scanIntervalMultiplier: 1.0 };
      case "volatile":
        return { profitThresholdMultiplier: 1.5, tradeSizeMultiplier: 0.7, scanIntervalMultiplier: 0.5 };
      case "trending":
        return { profitThresholdMultiplier: 1.2, tradeSizeMultiplier: 0.8, scanIntervalMultiplier: 0.8 };
      case "choppy":
        return { profitThresholdMultiplier: 2.0, tradeSizeMultiplier: 0.5, scanIntervalMultiplier: 1.5 };
    }
  }

  private classifyRegime(
    volatility: number, spreadMean: number, spreadStdDev: number, trendStrength: number
  ): { regime: MarketRegime; confidence: number } {
    // Thresholds (tuned for crypto markets)
    const highVol = volatility > 60;    // >60% annualized
    const wideSpread = spreadMean > 0.1; // >0.1% average spread
    const strongTrend = trendStrength > 0.01;
    const unstableSpread = spreadStdDev > spreadMean * 0.5;

    if (highVol && strongTrend) {
      return { regime: "trending", confidence: 0.7 };
    }
    if (highVol && !strongTrend) {
      return { regime: "choppy", confidence: 0.6 };
    }
    if (highVol || wideSpread || unstableSpread) {
      return { regime: "volatile", confidence: 0.65 };
    }
    return { regime: "calm", confidence: 0.75 };
  }

  private getRecommendation(regime: MarketRegime): string {
    switch (regime) {
      case "calm":
        return "Market is calm. Normal parameters. Good conditions for arb.";
      case "volatile":
        return "High volatility detected. Widen profit thresholds, reduce size, scan faster.";
      case "trending":
        return "Strong trend detected. Reduce position sizes — spreads may be directional.";
      case "choppy":
        return "Choppy/whipsaw market. Consider pausing or using very strict thresholds.";
    }
  }

  private defaultAnalysis(): RegimeAnalysis {
    return {
      regime: "calm",
      confidence: 0.5,
      volatility: 0,
      spreadMean: 0,
      spreadStdDev: 0,
      recommendation: "Default regime. Collecting more data.",
    };
  }
}

export const marketRegimeDetector = new MarketRegimeDetector();
