import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import { IStrategy, Opportunity, ExecutionResult } from "../strategy/IStrategy";
import { PaperExchangeAdapter } from "./PaperExchangeAdapter";
import { PaperLedger } from "./PaperLedger";
import { OrderSimulator } from "./OrderSimulator";
import { Transaction } from "../transactions/transaction.model";
import logger from "../core/logger.service";
import mongoose, { Schema } from "mongoose";

// MongoDB model for paper trading performance snapshots
const PaperPerformanceSchema = new Schema({
  engineId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  totalPnL: { type: Number, required: true },
  totalTrades: { type: Number, required: true },
  winRate: { type: Number, required: true },
  balances: { type: Schema.Types.Mixed },
});

export const PaperPerformance = mongoose.model("PaperPerformance", PaperPerformanceSchema);

export interface PaperEngineConfig {
  initialCapital: Record<string, Record<string, number>>; // exchange -> asset -> amount
  slippageBps?: number;
}

export interface PaperTradingResults {
  totalPnL: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  balances: Record<string, Record<string, number>>;
  trades: PaperTradeRecord[];
}

interface PaperTradeRecord {
  opportunityId: string;
  strategyId: string;
  timestamp: number;
  profit: number;
  success: boolean;
  legs: { exchange: string; symbol: string; side: string }[];
}

/**
 * Orchestrates paper trading. Creates PaperExchangeAdapters for each
 * real exchange, manages the PaperLedger, and records all paper transactions.
 */
export class PaperTradingEngine {
  readonly engineId: string;
  private ledger: PaperLedger;
  private simulator: OrderSimulator;
  private paperAdapters: Map<string, PaperExchangeAdapter> = new Map();
  private trades: PaperTradeRecord[] = [];
  private isRunning = false;
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(
    private realAdapters: Record<string, ExchangeAdapter>,
    private config: PaperEngineConfig,
    engineId?: string
  ) {
    this.engineId = engineId || `paper_${Date.now()}`;
    this.simulator = new OrderSimulator({
      slippageBps: config.slippageBps ?? 5,
      feeRate: 0.001, // default taker fee
    });
    this.ledger = new PaperLedger(config.initialCapital, this.engineId);

    // Create paper adapters wrapping each real adapter
    for (const [name, adapter] of Object.entries(realAdapters)) {
      this.paperAdapters.set(name, new PaperExchangeAdapter(adapter, this.ledger, this.simulator));
    }
  }

  /** Get paper adapter for an exchange (same interface as real adapter) */
  getAdapter(exchangeName: string): PaperExchangeAdapter | undefined {
    return this.paperAdapters.get(exchangeName);
  }

  /** Get all paper adapters as a Record (same shape as allExchanges) */
  getAllAdapters(): Record<string, ExchangeAdapter> {
    const result: Record<string, ExchangeAdapter> = {};
    for (const [name, adapter] of this.paperAdapters) {
      result[name] = adapter;
    }
    return result;
  }

  /** Get the paper ledger */
  getLedger(): PaperLedger {
    return this.ledger;
  }

  /**
   * Run a strategy continuously in paper mode.
   * Scans for opportunities and executes them using paper adapters.
   */
  async startStrategy(strategy: IStrategy, intervalMs = 2000): Promise<void> {
    if (this.isRunning) {
      logger.warn(`[PaperEngine] Already running`);
      return;
    }
    this.isRunning = true;
    logger.info(`[PaperEngine] Starting paper trading with strategy: ${strategy.metadata.name}`);

    // Try to restore previous ledger state
    const restored = await this.ledger.restore();
    if (!restored) {
      logger.info(`[PaperEngine] No previous state found, starting fresh`);
    }

    const runCycle = async () => {
      if (!this.isRunning) return;

      try {
        const opportunities = await strategy.scan();

        for (const opp of opportunities) {
          if (!this.isRunning) break;
          const result = await this.executeOpportunity(strategy, opp);
          if (result) {
            this.trades.push({
              opportunityId: opp.id,
              strategyId: strategy.metadata.id,
              timestamp: Date.now(),
              profit: result.actualProfit,
              success: result.success,
              legs: opp.legs.map(l => ({ exchange: l.exchange, symbol: l.symbol, side: l.side })),
            });

            // Save transaction to MongoDB with mode: 'paper'
            await this.savePaperTransaction(opp, result);
          }
        }
      } catch (err) {
        logger.error(`[PaperEngine] Scan cycle error`, err);
      }

      if (this.isRunning) {
        this.scanTimer = setTimeout(runCycle, intervalMs);
      }
    };

    await runCycle();
  }

  /** Execute an opportunity using paper adapters */
  private async executeOpportunity(
    strategy: IStrategy,
    opportunity: Opportunity
  ): Promise<ExecutionResult | null> {
    try {
      const result = await strategy.execute(opportunity);

      const status = result.success ? "PROFIT" : "LOSS";
      logger.info(
        `[PaperEngine] ${status}: ${result.actualProfit.toFixed(4)} USDT | ` +
        `Strategy: ${strategy.metadata.name} | Opp: ${opportunity.id}`
      );

      // Persist ledger after each trade
      await this.ledger.save();

      return result;
    } catch (err) {
      logger.error(`[PaperEngine] Execution error for ${opportunity.id}`, err);
      return null;
    }
  }

  /** Save a paper trade as a Transaction in MongoDB */
  private async savePaperTransaction(opp: Opportunity, result: ExecutionResult): Promise<void> {
    const sequenceId = `paper_${opp.id}`;
    for (let i = 0; i < opp.legs.length; i++) {
      const leg = opp.legs[i];
      const legResult = result.legs[i];
      await Transaction.create({
        type: opp.symbols.length > 1 ? "triangluar" : "direct",
        sequenceId,
        leg: i + 1,
        symbol: leg.symbol,
        side: leg.side,
        quantity: leg.size,
        status: legResult?.status || "PENDING",
        orderId: legResult?.orderId || "paper",
        exchange: leg.exchange,
        assetGiven: leg.side === "BUY" ? "USDT" : leg.symbol.slice(0, 3),
        assetReceived: leg.side === "BUY" ? leg.symbol.slice(0, 3) : "USDT",
        responseMsg: `Paper trade | Profit: ${result.actualProfit.toFixed(4)}`,
        mode: "paper",
        timestamp: new Date(),
      });
    }
  }

  /** Stop paper trading */
  stop(): void {
    this.isRunning = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    logger.info(`[PaperEngine] Stopped`);
  }

  /** Reset ledger and trade history */
  async reset(): Promise<void> {
    this.trades = [];
    this.ledger.reset();
    await this.ledger.save();
    logger.info(`[PaperEngine] Reset complete`);
  }

  /** Get current performance results */
  getResults(): PaperTradingResults {
    const winCount = this.trades.filter(t => t.profit > 0).length;
    const lossCount = this.trades.filter(t => t.profit <= 0).length;
    const totalPnL = this.trades.reduce((sum, t) => sum + t.profit, 0);

    return {
      totalPnL,
      totalTrades: this.trades.length,
      winCount,
      lossCount,
      winRate: this.trades.length > 0 ? winCount / this.trades.length : 0,
      balances: this.ledger.getAllBalances(),
      trades: this.trades,
    };
  }

  /** Save a performance snapshot to MongoDB */
  async savePerformanceSnapshot(): Promise<void> {
    const results = this.getResults();
    await PaperPerformance.create({
      engineId: this.engineId,
      totalPnL: results.totalPnL,
      totalTrades: results.totalTrades,
      winRate: results.winRate,
      balances: results.balances,
    });
  }
}
