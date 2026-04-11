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
        recommendations.push(`Evolution fitness stagnating after ${evo.totalGenerations} generations. Consider increasing mutation rate or adding new strategy types.`);
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
        recommendations.push(`Average spread very tight (${market.spreadMean.toFixed(4)}%). Hard to profit on major pairs. Altcoin and triangular arb are better bets.`);
      } else if (market.spreadMean > 0.1) {
        recommendations.push(`Wide average spread (${market.spreadMean.toFixed(4)}%). Good conditions for direct arbitrage. Increase scan speed.`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push("All systems running normally. Continue monitoring. Paper trade before committing real capital.");
    }

    return recommendations;
  }

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

  async saveInsight(category: string, title: string, content: string, confidence: number = 0.5): Promise<void> {
    await AdvisorInsight.create({ category, title, content, confidence });
  }

  async getPerformanceTrend(period: "hourly" | "daily", count: number = 10): Promise<any[]> {
    return PerformanceSnapshot.find({ period }).sort({ timestamp: -1 }).limit(count).lean();
  }
}

export const advisorBrain = new AdvisorBrain();
