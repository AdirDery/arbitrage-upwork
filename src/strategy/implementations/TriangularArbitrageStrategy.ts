import {
  IStrategy, StrategyMetadata, StrategyConfig,
  Opportunity, OpportunityScore, ExecutionResult, TradeLeg, LegResult
} from "../IStrategy";
import { ExchangeAdapter } from "../../arbitrage/arbitrage.types";
import { Orderbook } from "../../orderBooks/ordrbooks.types";
import { exchangeSymbols } from "../../paths/symbols";
import { basePaths, generateCrossExchangePaths } from "../../paths/paths";
import logger from "../../core/logger.service";

export interface TriangularArbConfig extends StrategyConfig {
  allExchanges: Record<string, ExchangeAdapter>;
  capital: number;          // USDT capital per trade
  profitThreshold: number;  // minimum USD profit
}

/**
 * Triangular arbitrage: 3-leg cross-exchange trades.
 * e.g., USDT→SOL (Binance) → SOL→BTC (Bybit) → BTC→USDT (OKX)
 */
export class TriangularArbitrageStrategy implements IStrategy {
  readonly metadata: StrategyMetadata;
  private config!: TriangularArbConfig;

  constructor(id?: string) {
    this.metadata = {
      id: id || `triangular_${Date.now()}`,
      name: "Triangular Arbitrage",
      type: "triangular",
      riskLevel: "medium",
      description: "3-leg cross-exchange triangular arbitrage",
    };
  }

  async initialize(config: TriangularArbConfig): Promise<void> {
    this.config = config;
  }

  getConfig(): TriangularArbConfig { return { ...this.config }; }

  updateConfig(config: Partial<TriangularArbConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async scan(): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];
    const paths = await generateCrossExchangePaths(exchangeSymbols, basePaths);

    for (const path of paths) {
      try {
        const opp = await this.evaluatePath(path);
        if (opp && opp.estimatedProfit >= this.config.profitThreshold) {
          opportunities.push(opp);
        }
      } catch (err) {
        // Skip failed path evaluations
      }
    }

    return opportunities;
  }

  private async evaluatePath(
    path: { exchange: string; symbol: string; direction: string }[]
  ): Promise<Opportunity | null> {
    const { allExchanges, capital } = this.config;

    const ex1 = allExchanges[path[0].exchange];
    const ex2 = allExchanges[path[1].exchange];
    const ex3 = allExchanges[path[2].exchange];
    if (!ex1 || !ex2 || !ex3) return null;

    // Fetch all 3 orderbooks in parallel
    const [book1, book2, book3] = await Promise.all([
      ex1.getOrderbook(path[0].symbol),
      ex2.getOrderbook(path[1].symbol),
      ex3.getOrderbook(path[2].symbol),
    ]);

    if (this.isEmpty(book1) || this.isEmpty(book2) || this.isEmpty(book3)) return null;

    // Get fees in parallel
    const [fee1, fee2, fee3] = await Promise.all([
      ex1.getFees(path[0].symbol),
      ex2.getFees(path[1].symbol),
      ex3.getFees(path[2].symbol),
    ]);

    // Trade 1: Buy base with USDT (use asks)
    const trade1Amount = capital / book1.asks[0][0];
    const trade1AfterFee = trade1Amount * (1 - fee1.taker);

    // Trade 2: Sell/convert using asks price
    const trade2Amount = trade1AfterFee * book2.asks[0][0];
    const trade2AfterFee = trade2Amount * (1 - fee2.taker);

    // Trade 3: Sell back to USDT (use bids)
    const trade3Amount = trade2AfterFee * book3.bids[0][0];
    const trade3AfterFee = trade3Amount * (1 - fee3.taker);

    const finalUsdt = trade3AfterFee;
    const profit = finalUsdt - capital;
    const roi = profit / capital;

    if (profit <= 0) return null;

    const legs: TradeLeg[] = [
      { exchange: ex1.name, symbol: path[0].symbol, side: "BUY", size: trade1AfterFee, expectedPrice: book1.asks[0][0] },
      { exchange: ex2.name, symbol: path[1].symbol, side: "SELL", size: trade1AfterFee, expectedPrice: book2.asks[0][0] },
      { exchange: ex3.name, symbol: path[2].symbol, side: "SELL", size: trade2AfterFee, expectedPrice: book3.bids[0][0] },
    ];

    return {
      id: `tri_${ex1.name}_${ex2.name}_${ex3.name}_${Date.now()}`,
      strategyId: this.metadata.id,
      timestamp: Date.now(),
      exchanges: [ex1.name, ex2.name, ex3.name],
      symbols: [path[0].symbol, path[1].symbol, path[2].symbol],
      legs,
      estimatedProfit: profit,
      estimatedROI: roi,
      score: {
        profitEstimate: profit,
        confidence: 0.6,
        riskScore: 0.5,
        urgency: 0.9,
      },
      metadata: {
        capital,
        finalUsdt,
        tradePairs: path.map(p => p.symbol),
        path: path.map(p => `${p.exchange}:${p.symbol}`),
      },
    };
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityScore> {
    return opportunity.score;
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const legResults: LegResult[] = [];
    const { allExchanges } = this.config;

    try {
      const [leg1, leg2, leg3] = opportunity.legs;
      const ex1 = allExchanges[leg1.exchange];
      const ex2 = allExchanges[leg2.exchange];
      const ex3 = allExchanges[leg3.exchange];

      // Execute all 3 legs in parallel
      const [res1, res2, res3] = await Promise.all([
        ex1.marketBuy(leg1.symbol, leg1.size),
        ex2.marketSell(leg2.symbol, leg2.size),
        ex3.marketSell(leg3.symbol, leg3.size),
      ]);

      const results = [
        { res: res1, leg: leg1 },
        { res: res2, leg: leg2 },
        { res: res3, leg: leg3 },
      ];

      for (const { res, leg } of results) {
        legResults.push({
          orderId: res?.orderId || "unknown",
          exchange: leg.exchange,
          symbol: leg.symbol,
          side: leg.side,
          requestedSize: leg.size,
          filledSize: Number(res?.amount) || leg.size,
          avgPrice: Number(res?.price) || leg.expectedPrice,
          fee: 0,
          status: res?.status === "SUCCESS" ? "SUCCESS" : "FAILED",
        });
      }

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

  async dispose(): Promise<void> {}

  private isEmpty(book: { bids: [number, number][]; asks: [number, number][] }): boolean {
    return book.asks.length === 0 || book.bids.length === 0;
  }
}
