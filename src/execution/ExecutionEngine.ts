import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import { TradeLeg, LegResult, ExecutionResult, Opportunity } from "../strategy/IStrategy";
import logger from "../core/logger.service";

/**
 * Centralized execution engine with sequential leg execution and rollback.
 *
 * Instead of Promise.all (dangerous — if one leg fails, you're unhedged),
 * this executes legs sequentially. If leg N fails, it unwinds legs 1..N-1
 * with compensating trades.
 */
export class ExecutionEngine {
  constructor(
    private adapters: Record<string, ExchangeAdapter>,
    private maxRetries: number = 2
  ) {}

  /**
   * Execute an opportunity's legs sequentially with rollback on failure.
   */
  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const completedLegs: { leg: TradeLeg; result: LegResult }[] = [];

    for (const leg of opportunity.legs) {
      const adapter = this.adapters[leg.exchange];
      if (!adapter) {
        // Rollback all completed legs
        await this.rollback(completedLegs);
        return this.failureResult(opportunity, completedLegs, startTime, `Unknown exchange: ${leg.exchange}`);
      }

      const result = await this.executeLeg(adapter, leg);

      if (result.status === "FAILED") {
        logger.warn(`[ExecutionEngine] Leg failed: ${leg.side} ${leg.symbol} on ${leg.exchange}. Rolling back.`);
        await this.rollback(completedLegs);
        return this.failureResult(opportunity, completedLegs, startTime, `Leg failed: ${leg.side} ${leg.symbol} on ${leg.exchange}`);
      }

      completedLegs.push({ leg, result });
    }

    const legResults = completedLegs.map(c => c.result);

    return {
      success: true,
      opportunityId: opportunity.id,
      legs: legResults,
      actualProfit: opportunity.estimatedProfit, // TODO: calculate from actual fill prices
      actualROI: opportunity.estimatedROI,
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async executeLeg(adapter: ExchangeAdapter, leg: TradeLeg): Promise<LegResult> {
    let lastError = "";

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = leg.side === "BUY"
          ? await adapter.marketBuy(leg.symbol, leg.size)
          : await adapter.marketSell(leg.symbol, leg.size);

        const status = res?.status === "SUCCESS" || res?.orderId ? "SUCCESS" : "FAILED";

        return {
          orderId: res?.orderId || "unknown",
          exchange: leg.exchange,
          symbol: leg.symbol,
          side: leg.side,
          requestedSize: leg.size,
          filledSize: Number(res?.amount) || leg.size,
          avgPrice: Number(res?.price) || leg.expectedPrice,
          fee: 0,
          status,
        };
      } catch (err: any) {
        lastError = err.message;
        logger.warn(`[ExecutionEngine] Attempt ${attempt + 1}/${this.maxRetries + 1} failed for ${leg.side} ${leg.symbol}: ${lastError}`);
      }
    }

    return {
      orderId: "failed",
      exchange: leg.exchange,
      symbol: leg.symbol,
      side: leg.side,
      requestedSize: leg.size,
      filledSize: 0,
      avgPrice: 0,
      fee: 0,
      status: "FAILED",
    };
  }

  /**
   * Rollback completed legs by executing compensating trades.
   * If we bought on Exchange A, sell it back. If we sold, buy it back.
   */
  private async rollback(completedLegs: { leg: TradeLeg; result: LegResult }[]): Promise<void> {
    if (completedLegs.length === 0) return;

    logger.warn(`[ExecutionEngine] Rolling back ${completedLegs.length} completed legs`);

    // Reverse order — unwind from last to first
    for (let i = completedLegs.length - 1; i >= 0; i--) {
      const { leg, result } = completedLegs[i];
      const adapter = this.adapters[leg.exchange];
      if (!adapter) continue;

      try {
        // Compensating trade: opposite side
        if (leg.side === "BUY") {
          // We bought, so sell it back
          await adapter.marketSell(leg.symbol, result.filledSize);
          logger.info(`[ExecutionEngine] Rollback: sold ${result.filledSize} ${leg.symbol} on ${leg.exchange}`);
        } else {
          // We sold, so buy it back
          await adapter.marketBuy(leg.symbol, result.filledSize);
          logger.info(`[ExecutionEngine] Rollback: bought ${result.filledSize} ${leg.symbol} on ${leg.exchange}`);
        }
      } catch (err) {
        logger.error(`[ExecutionEngine] CRITICAL: Rollback failed for leg ${i} (${leg.side} ${leg.symbol} on ${leg.exchange})`, err);
        // Can't do much here — log it and alert
      }
    }
  }

  private failureResult(
    opportunity: Opportunity,
    completedLegs: { leg: TradeLeg; result: LegResult }[],
    startTime: number,
    error: string
  ): ExecutionResult {
    return {
      success: false,
      opportunityId: opportunity.id,
      legs: completedLegs.map(c => c.result),
      actualProfit: 0,
      actualROI: 0,
      executionTimeMs: Date.now() - startTime,
      error,
    };
  }
}
