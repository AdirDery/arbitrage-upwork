import { Population, PopulationConfig, GenerationReport } from "./Population";
import { BrainRecord, GenerationRecord, EvolutionConfig } from "./evolution.model";
import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import logger from "../core/logger.service";

/**
 * Top-level orchestrator for multi-brain evolution.
 *
 * Cycle:
 * 1. Initialize population with random chromosomes
 * 2. All brains paper-trade for evaluationPeriodHours
 * 3. Stop brains, evaluate fitness
 * 4. Select, crossover, mutate → next generation
 * 5. Repeat
 *
 * Top brain can be "graduated" to live trading via Telegram command.
 */
export class EvolutionEngine {
  private population: Population | null = null;
  private isRunning = false;
  private cycleTimer: NodeJS.Timeout | null = null;
  private currentGeneration = 0;
  private reports: GenerationReport[] = [];

  constructor(
    private realAdapters: Record<string, ExchangeAdapter>,
    private allSymbols: string[]
  ) {}

  /**
   * Start the evolution engine with given config.
   */
  async start(config?: Partial<PopulationConfig>): Promise<void> {
    if (this.isRunning) {
      logger.warn("[EvolutionEngine] Already running");
      return;
    }

    // Load or create config from DB
    let dbConfig = await EvolutionConfig.findOne({ configId: "default" });
    if (!dbConfig) {
      dbConfig = await EvolutionConfig.create({ configId: "default" });
    }

    const popConfig: PopulationConfig = {
      populationSize: config?.populationSize ?? dbConfig.populationSize ?? 10,
      eliteCount: config?.eliteCount ?? dbConfig.eliteCount ?? 2,
      mutationRate: config?.mutationRate ?? dbConfig.mutationRate ?? 0.2,
      crossoverRate: config?.crossoverRate ?? dbConfig.crossoverRate ?? 0.7,
      tournamentSize: config?.tournamentSize ?? dbConfig.tournamentSize ?? 3,
      strategyType: config?.strategyType ?? dbConfig.strategyType ?? "direct",
    };

    const evalPeriodMs = (dbConfig.evaluationPeriodHours ?? 24) * 60 * 60 * 1000;

    this.isRunning = true;
    await EvolutionConfig.updateOne({ configId: "default" }, { isRunning: true });

    logger.info(
      `[EvolutionEngine] Starting | Population: ${popConfig.populationSize} | ` +
      `Strategy: ${popConfig.strategyType} | Eval Period: ${dbConfig.evaluationPeriodHours}h`
    );

    // Initialize and start first generation
    this.population = new Population(popConfig, this.realAdapters, this.allSymbols);
    await this.population.initialize();
    await this.population.startAll();

    // Schedule evolution cycle
    this.scheduleEvolutionCycle(evalPeriodMs, popConfig);
  }

  private scheduleEvolutionCycle(evalPeriodMs: number, config: PopulationConfig): void {
    this.cycleTimer = setTimeout(async () => {
      if (!this.isRunning || !this.population) return;

      try {
        // 1. Stop and evaluate
        const report = await this.population.stopAll();
        this.reports.push(report);
        this.currentGeneration = this.population.getGeneration();

        // 2. Save to MongoDB
        await this.saveGenerationReport(report);
        await this.saveBrainRecords();

        // 3. Evolve
        await this.population.evolve();

        // 4. Start next generation
        await this.population.startAll();

        logger.info(`[EvolutionEngine] Generation ${this.currentGeneration} complete. Starting Generation ${this.population.getGeneration()}`);

        // 5. Schedule next cycle
        if (this.isRunning) {
          this.scheduleEvolutionCycle(evalPeriodMs, config);
        }
      } catch (err) {
        logger.error("[EvolutionEngine] Evolution cycle error", err);
        // Retry after a delay
        if (this.isRunning) {
          setTimeout(() => this.scheduleEvolutionCycle(evalPeriodMs, config), 60000);
        }
      }
    }, evalPeriodMs);
  }

  /** Stop the evolution engine */
  async stop(): Promise<GenerationReport | null> {
    if (!this.isRunning || !this.population) return null;

    this.isRunning = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }

    // Stop current generation and get final report
    const report = await this.population.stopAll();
    this.reports.push(report);

    await this.saveGenerationReport(report);
    await this.saveBrainRecords();
    await EvolutionConfig.updateOne({ configId: "default" }, { isRunning: false });

    logger.info("[EvolutionEngine] Stopped");
    return report;
  }

  /** Get current status */
  getStatus(): {
    running: boolean;
    generation: number;
    populationSize: number;
    topBrains: { id: string; fitness: number; generation: number }[];
    recentReports: GenerationReport[];
  } {
    const topBrains = this.population?.getTopBrains(5).map(b => ({
      id: b.id,
      fitness: b.fitness,
      generation: b.chromosome.generation,
    })) || [];

    return {
      running: this.isRunning,
      generation: this.population?.getGeneration() || 0,
      populationSize: this.population?.getSize() || 0,
      topBrains,
      recentReports: this.reports.slice(-5),
    };
  }

  /** Get the best brain's chromosome (for graduation to live trading) */
  getBestBrainChromosome() {
    const best = this.population?.getBestBrain();
    if (!best) return null;
    return {
      id: best.id,
      chromosome: best.chromosome,
      fitness: best.fitness,
      metrics: best.metrics,
      summary: best.getSummary(),
    };
  }

  private async saveGenerationReport(report: GenerationReport): Promise<void> {
    await GenerationRecord.create({
      generation: report.generation,
      bestFitness: report.bestFitness,
      avgFitness: report.avgFitness,
      bestBrainId: report.bestBrainId,
      brainSummaries: report.brainSummaries,
      populationSize: report.brainSummaries.length,
    });
  }

  private async saveBrainRecords(): Promise<void> {
    if (!this.population) return;

    for (const brain of this.population.getBrains()) {
      await BrainRecord.findOneAndUpdate(
        { brainId: brain.id },
        {
          brainId: brain.id,
          strategyType: brain.chromosome.strategyType,
          chromosome: brain.chromosome,
          generation: brain.chromosome.generation,
          fitness: brain.fitness,
          metrics: brain.metrics,
        },
        { upsert: true }
      );
    }
  }
}
