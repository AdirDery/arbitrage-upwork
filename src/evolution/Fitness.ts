import { Transaction } from "../transactions/transaction.model";
import logger from "../core/logger.service";

export interface FitnessMetrics {
  totalReturn: number;      // total USD profit/loss
  sharpeRatio: number;      // risk-adjusted return (higher = better)
  profitFactor: number;     // gross profit / gross loss (>1 = profitable)
  maxDrawdown: number;      // worst peak-to-trough decline (0-1)
  winRate: number;          // fraction of profitable trades
  tradeCount: number;
  avgTradeProfit: number;
}

/**
 * Evaluates strategy fitness from paper trading history.
 * Used by the evolution engine to rank brains and select the fittest.
 */
export class FitnessEvaluator {

  // Weights for composite fitness score
  private weights = {
    sharpe: 0.35,
    profitFactor: 0.25,
    drawdown: 0.20,
    winRate: 0.10,
    tradeCount: 0.10,
  };

  /**
   * Calculate composite fitness score from metrics.
   * Higher = better. Range roughly 0-1 for typical strategies.
   */
  calculateFitness(metrics: FitnessMetrics): number {
    if (metrics.tradeCount === 0) return 0;

    // Normalize each metric to roughly 0-1 range
    const sharpeFit = Math.max(0, Math.min(1, (metrics.sharpeRatio + 1) / 4)); // -1 to 3 -> 0 to 1
    const pfFit = Math.max(0, Math.min(1, (metrics.profitFactor - 0.5) / 2));  // 0.5 to 2.5 -> 0 to 1
    const ddFit = 1 - metrics.maxDrawdown; // lower drawdown = higher fitness
    const wrFit = metrics.winRate;
    const tcFit = Math.min(1, metrics.tradeCount / 50); // 50+ trades = max score

    const fitness =
      this.weights.sharpe * sharpeFit +
      this.weights.profitFactor * pfFit +
      this.weights.drawdown * ddFit +
      this.weights.winRate * wrFit +
      this.weights.tradeCount * tcFit;

    return Math.max(0, fitness);
  }

  /**
   * Extract fitness metrics from a brain's paper trading history in MongoDB.
   * Groups transactions by sequenceId, calculates per-trade P&L, then derives metrics.
   */
  async extractMetrics(brainId: string, periodHours: number = 24): Promise<FitnessMetrics> {
    const since = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    // Find all paper transactions for this brain's engine
    const transactions = await Transaction.find({
      mode: "paper",
      sequenceId: { $regex: `paper_.*${brainId}` },
      timestamp: { $gte: since },
    }).sort({ timestamp: 1 });

    if (transactions.length === 0) {
      return this.emptyMetrics();
    }

    // Group by sequenceId to get per-trade results
    const tradeGroups = new Map<string, any[]>();
    for (const tx of transactions) {
      const seq = tx.sequenceId;
      if (!tradeGroups.has(seq)) tradeGroups.set(seq, []);
      tradeGroups.get(seq)!.push(tx);
    }

    // Extract per-trade profits from responseMsg (format: "Paper trade | Profit: X.XXXX")
    const tradeProfits: number[] = [];
    for (const [, txs] of tradeGroups) {
      const firstTx = txs[0];
      const profitMatch = firstTx.responseMsg?.match(/Profit:\s*([-\d.]+)/);
      if (profitMatch) {
        tradeProfits.push(Number(profitMatch[1]));
      }
    }

    if (tradeProfits.length === 0) {
      return this.emptyMetrics();
    }

    return this.computeMetrics(tradeProfits);
  }

  /**
   * Compute metrics directly from an array of per-trade profits.
   * Used both for MongoDB extraction and for in-memory calculation.
   */
  computeMetrics(tradeProfits: number[]): FitnessMetrics {
    const tradeCount = tradeProfits.length;
    if (tradeCount === 0) return this.emptyMetrics();

    const totalReturn = tradeProfits.reduce((sum, p) => sum + p, 0);
    const avgTradeProfit = totalReturn / tradeCount;

    // Win rate
    const wins = tradeProfits.filter(p => p > 0);
    const losses = tradeProfits.filter(p => p <= 0);
    const winRate = wins.length / tradeCount;

    // Profit factor
    const grossProfit = wins.reduce((sum, p) => sum + p, 0);
    const grossLoss = Math.abs(losses.reduce((sum, p) => sum + p, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

    // Sharpe ratio (annualized, assuming ~24 trades/day)
    const mean = avgTradeProfit;
    const variance = tradeProfits.reduce((sum, p) => sum + (p - mean) ** 2, 0) / tradeCount;
    const stdDev = Math.sqrt(variance);
    const dailyReturn = totalReturn; // Approximate: all trades in one day
    const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    // Max drawdown
    const maxDrawdown = this.computeMaxDrawdown(tradeProfits);

    return {
      totalReturn,
      sharpeRatio,
      profitFactor,
      maxDrawdown,
      winRate,
      tradeCount,
      avgTradeProfit,
    };
  }

  private computeMaxDrawdown(profits: number[]): number {
    let peak = 0;
    let cumulative = 0;
    let maxDD = 0;

    for (const p of profits) {
      cumulative += p;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak > 0 ? (peak - cumulative) / peak : 0;
      if (drawdown > maxDD) maxDD = drawdown;
    }

    return maxDD;
  }

  private emptyMetrics(): FitnessMetrics {
    return {
      totalReturn: 0,
      sharpeRatio: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      winRate: 0,
      tradeCount: 0,
      avgTradeProfit: 0,
    };
  }
}

export const fitnessEvaluator = new FitnessEvaluator();
