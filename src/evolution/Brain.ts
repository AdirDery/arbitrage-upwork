import { Chromosome, chromosomeToConfig } from "./Chromosome";
import { FitnessMetrics, fitnessEvaluator } from "./Fitness";
import { IStrategy } from "../strategy/IStrategy";
import { DirectArbitrageStrategy } from "../strategy/implementations/DirectArbitrageStrategy";
import { TriangularArbitrageStrategy } from "../strategy/implementations/TriangularArbitrageStrategy";
import { AltcoinArbitrageStrategy, ALTCOIN_SYMBOLS } from "../strategy/implementations/AltcoinArbitrageStrategy";
import { FundingRateStrategy } from "../strategy/implementations/FundingRateStrategy";
import { StatisticalArbitrageStrategy } from "../strategy/implementations/StatisticalArbitrageStrategy";
import { PaperTradingEngine } from "../paper/PaperTradingEngine";
import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import logger from "../core/logger.service";

/**
 * A Brain = strategy instance + chromosome parameters + paper trading engine.
 * Each brain in the population is an independent paper trader.
 * All brains share the same OrderbookManager (no extra API calls).
 */
export class Brain {
  readonly id: string;
  readonly chromosome: Chromosome;
  private strategy: IStrategy | null = null;
  private paperEngine: PaperTradingEngine | null = null;
  private _fitness: number = 0;
  private _metrics: FitnessMetrics | null = null;
  private _isAlive: boolean = false;
  private tradeProfits: number[] = [];

  constructor(
    chromosome: Chromosome,
    private realAdapters: Record<string, ExchangeAdapter>,
    private allSymbols: string[]
  ) {
    this.id = chromosome.id;
    this.chromosome = chromosome;
  }

  get fitness(): number { return this._fitness; }
  get metrics(): FitnessMetrics | null { return this._metrics; }
  get isAlive(): boolean { return this._isAlive; }

  /**
   * Start the brain: create paper engine, initialize strategy from chromosome, begin scanning.
   */
  async start(): Promise<void> {
    if (this._isAlive) return;

    const config = chromosomeToConfig(this.chromosome);

    // Create paper engine with virtual capital per exchange
    const initialCapital: Record<string, Record<string, number>> = {};
    for (const name of Object.keys(this.realAdapters)) {
      // Use exchange weights from chromosome to decide capital allocation
      const weight = config[`weight_${name}`] ?? 1;
      if (weight > 0.1) {
        initialCapital[name] = { USDT: 10000 };
      }
    }

    this.paperEngine = new PaperTradingEngine(
      this.realAdapters,
      { initialCapital, slippageBps: Math.round((config.maxSlippagePct || 0.1) * 100) },
      this.id
    );

    // Create strategy based on chromosome type
    const paperAdapters = this.paperEngine.getAllAdapters();
    const activeExchanges = Object.values(paperAdapters).filter((_, i) => {
      const name = Object.keys(paperAdapters)[i];
      const weight = config[`weight_${name}`] ?? 1;
      return weight > 0.1;
    });

    if (this.chromosome.strategyType === "direct") {
      const strategy = new DirectArbitrageStrategy(this.id);
      await strategy.initialize({
        exchanges: activeExchanges,
        symbols: this.allSymbols,
        tradeSize: config.tradeSize || 0.5,
        profitThreshold: config.profitThreshold || 0.5,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "triangular") {
      const strategy = new TriangularArbitrageStrategy(this.id);
      await strategy.initialize({
        allExchanges: paperAdapters as any,
        capital: config.capital || 200,
        profitThreshold: config.profitThreshold || 0.5,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "altcoin") {
      const strategy = new AltcoinArbitrageStrategy(this.id);
      await strategy.initialize({
        exchanges: activeExchanges,
        symbols: ALTCOIN_SYMBOLS,
        tradeSize: config.tradeSize || 50,
        profitThreshold: config.profitThreshold || 0.3,
        minSpreadPct: config.minSpreadPct || 0.3,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "funding") {
      const strategy = new FundingRateStrategy(this.id);
      await strategy.initialize({
        spotAdapters: paperAdapters as any,
        futuresAdapters: {},
        symbols: this.allSymbols,
        minFundingRate: config.minFundingRate || 0.0003,
        capitalPerPosition: config.capitalPerPosition || 500,
        maxPositions: config.maxPositions || 3,
        closeAfterReversals: config.closeAfterReversals || 2,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "statistical") {
      const strategy = new StatisticalArbitrageStrategy(this.id);
      const exchangeName = Object.keys(paperAdapters)[0] || "Binance";
      await strategy.initialize({
        exchanges: activeExchanges,
        tradeSize: config.tradeSize || 200,
        zScoreThreshold: config.zScoreThreshold || 2.0,
        minCorrelation: config.minCorrelation || 0.7,
        exchange: exchangeName,
      });
      this.strategy = strategy;
    }

    if (!this.strategy) {
      logger.error(`[Brain ${this.id}] Unknown strategy type: ${this.chromosome.strategyType}`);
      return;
    }

    this._isAlive = true;
    const interval = config.scanInterval || 2000;

    // Start paper trading
    this.paperEngine.startStrategy(this.strategy, interval);
    logger.info(`[Brain ${this.id}] Started | Gen: ${this.chromosome.generation} | Interval: ${interval}ms`);
  }

  /** Stop the brain and evaluate final fitness */
  async stop(): Promise<FitnessMetrics> {
    this._isAlive = false;

    if (this.paperEngine) {
      this.paperEngine.stop();

      // Collect trade results
      const results = this.paperEngine.getResults();
      this.tradeProfits = results.trades.map(t => t.profit);
    }

    this._metrics = fitnessEvaluator.computeMetrics(this.tradeProfits);
    this._fitness = fitnessEvaluator.calculateFitness(this._metrics);

    logger.info(
      `[Brain ${this.id}] Stopped | Fitness: ${this._fitness.toFixed(4)} | ` +
      `Trades: ${this._metrics.tradeCount} | Return: $${this._metrics.totalReturn.toFixed(4)} | ` +
      `WinRate: ${(this._metrics.winRate * 100).toFixed(1)}%`
    );

    return this._metrics;
  }

  /** Get a summary for display */
  getSummary(): string {
    const config = chromosomeToConfig(this.chromosome);
    const genes = this.chromosome.genes.map(g => `${g.name}=${g.value}`).join(", ");
    return `Brain ${this.id} | Gen ${this.chromosome.generation} | Fitness: ${this._fitness.toFixed(4)} | ${genes}`;
  }
}
