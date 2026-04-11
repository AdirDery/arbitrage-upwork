import { Brain } from "./Brain";
import { Chromosome } from "./Chromosome";
import { GeneticOperators, geneticOperators } from "./GeneticOperators";
import { FitnessMetrics } from "./Fitness";
import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import logger from "../core/logger.service";

export interface PopulationConfig {
  populationSize: number;       // 10-20 brains
  eliteCount: number;           // top N survive unchanged (e.g., 2)
  mutationRate: number;         // 0.1-0.3
  crossoverRate: number;        // 0.6-0.8
  tournamentSize: number;       // k for tournament selection (e.g., 3)
  strategyType: string;         // "direct" | "triangular" | "altcoin" | "funding" | "statistical" | "mixed"
}

export interface GenerationReport {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  bestBrainId: string;
  brainSummaries: { id: string; fitness: number; trades: number; return: number }[];
  timestamp: number;
}

/**
 * Manages a population of competing brains.
 * Handles lifecycle: initialization, evaluation, selection, evolution.
 */
export class Population {
  private brains: Brain[] = [];
  private generation = 0;
  private reports: GenerationReport[] = [];

  constructor(
    private config: PopulationConfig,
    private realAdapters: Record<string, ExchangeAdapter>,
    private allSymbols: string[]
  ) {}

  /** Initialize population with random chromosomes */
  async initialize(): Promise<void> {
    const { populationSize, strategyType } = this.config;
    logger.info(`[Population] Initializing ${populationSize} brains for ${strategyType}`);

    const STRATEGY_TYPES = ["direct", "triangular", "altcoin", "statistical"];
    this.brains = [];

    for (let i = 0; i < populationSize; i++) {
      let type: string;
      if (strategyType === "mixed") {
        type = STRATEGY_TYPES[i % STRATEGY_TYPES.length];
      } else {
        type = strategyType;
      }
      const chromosome = geneticOperators.randomChromosome(type);
      const brain = new Brain(chromosome, this.realAdapters, this.allSymbols);
      this.brains.push(brain);
    }

    this.generation = 0;
  }

  /** Start all brains in the population (paper trading) */
  async startAll(): Promise<void> {
    logger.info(`[Population] Starting ${this.brains.length} brains (Generation ${this.generation})`);
    for (const brain of this.brains) {
      await brain.start();
      // Small delay to avoid hammering all exchanges simultaneously
      await new Promise(r => setTimeout(r, 200));
    }
  }

  /** Stop all brains and evaluate fitness */
  async stopAll(): Promise<GenerationReport> {
    logger.info(`[Population] Stopping all brains and evaluating fitness...`);

    const summaries: GenerationReport["brainSummaries"] = [];

    for (const brain of this.brains) {
      const metrics = await brain.stop();
      summaries.push({
        id: brain.id,
        fitness: brain.fitness,
        trades: metrics.tradeCount,
        return: metrics.totalReturn,
      });
    }

    // Sort by fitness descending
    summaries.sort((a, b) => b.fitness - a.fitness);

    const report: GenerationReport = {
      generation: this.generation,
      bestFitness: summaries[0]?.fitness || 0,
      avgFitness: summaries.reduce((sum, s) => sum + s.fitness, 0) / summaries.length,
      bestBrainId: summaries[0]?.id || "none",
      brainSummaries: summaries,
      timestamp: Date.now(),
    };

    this.reports.push(report);
    logger.info(
      `[Population] Gen ${this.generation} | Best: ${report.bestFitness.toFixed(4)} | ` +
      `Avg: ${report.avgFitness.toFixed(4)} | Best Brain: ${report.bestBrainId}`
    );

    return report;
  }

  /**
   * Evolve the population: select parents, crossover, mutate, create next generation.
   * Elite brains survive unchanged.
   */
  async evolve(): Promise<void> {
    const { eliteCount, crossoverRate, mutationRate, tournamentSize } = this.config;

    // Sort brains by fitness
    const ranked = [...this.brains].sort((a, b) => b.fitness - a.fitness);

    // Elite: top N survive unchanged
    const eliteChromosomes = ranked.slice(0, eliteCount).map(b => b.chromosome);

    // Build fitness array for tournament selection
    const pool = ranked.map(b => ({ chromosome: b.chromosome, fitness: b.fitness }));

    // Generate offspring to fill the rest of the population
    const offspringChromosomes: Chromosome[] = [];
    const neededOffspring = this.config.populationSize - eliteCount;

    while (offspringChromosomes.length < neededOffspring) {
      const parent1 = geneticOperators.tournamentSelect(pool, tournamentSize);
      const parent2 = geneticOperators.tournamentSelect(pool, tournamentSize);

      let child1: Chromosome, child2: Chromosome;

      if (Math.random() < crossoverRate) {
        [child1, child2] = geneticOperators.crossover(parent1, parent2);
      } else {
        // No crossover — just clone parents
        child1 = { ...parent1, id: `brain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
        child2 = { ...parent2, id: `brain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
      }

      // Mutate
      child1 = geneticOperators.mutate(child1, mutationRate);
      child2 = geneticOperators.mutate(child2, mutationRate);

      offspringChromosomes.push(child1);
      if (offspringChromosomes.length < neededOffspring) {
        offspringChromosomes.push(child2);
      }
    }

    // Create new population
    const allChromosomes = [...eliteChromosomes, ...offspringChromosomes];
    this.brains = allChromosomes.map(
      c => new Brain(c, this.realAdapters, this.allSymbols)
    );

    this.generation++;
    logger.info(`[Population] Evolved to Generation ${this.generation} | Elite: ${eliteCount} | New: ${offspringChromosomes.length}`);
  }

  /** Get the best performing brain */
  getBestBrain(): Brain | null {
    if (this.brains.length === 0) return null;
    return [...this.brains].sort((a, b) => b.fitness - a.fitness)[0];
  }

  /** Get top N brains */
  getTopBrains(n: number): Brain[] {
    return [...this.brains].sort((a, b) => b.fitness - a.fitness).slice(0, n);
  }

  /** Get all generation reports */
  getReports(): GenerationReport[] {
    return this.reports;
  }

  getGeneration(): number { return this.generation; }
  getSize(): number { return this.brains.length; }
  getBrains(): Brain[] { return this.brains; }
}
