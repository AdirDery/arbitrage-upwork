import { Chromosome, Gene, snapToStep, STRATEGY_GENES } from "./Chromosome";

/**
 * Core genetic algorithm operators: selection, crossover, mutation.
 */
export class GeneticOperators {

  /**
   * Tournament selection: pick k random brains, return the fittest.
   * This balances exploration (randomness) with exploitation (fitness pressure).
   */
  tournamentSelect(
    population: { chromosome: Chromosome; fitness: number }[],
    tournamentSize: number = 3
  ): Chromosome {
    const candidates: typeof population[0][] = [];
    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * population.length);
      candidates.push(population[idx]);
    }
    candidates.sort((a, b) => b.fitness - a.fitness);
    return candidates[0].chromosome;
  }

  /**
   * Single-point crossover: pick a random gene index, swap everything after it.
   * Returns two children combining traits from both parents.
   */
  crossover(parent1: Chromosome, parent2: Chromosome): [Chromosome, Chromosome] {
    const geneCount = parent1.genes.length;
    const crossPoint = 1 + Math.floor(Math.random() * (geneCount - 1)); // avoid 0 and length

    const child1Genes: Gene[] = [];
    const child2Genes: Gene[] = [];

    for (let i = 0; i < geneCount; i++) {
      if (i < crossPoint) {
        child1Genes.push({ ...parent1.genes[i] });
        child2Genes.push({ ...parent2.genes[i] });
      } else {
        child1Genes.push({ ...parent2.genes[i] });
        child2Genes.push({ ...parent1.genes[i] });
      }
    }

    const now = Date.now();
    const child1: Chromosome = {
      id: `brain_${now}_a`,
      strategyType: parent1.strategyType,
      genes: child1Genes,
      generation: Math.max(parent1.generation, parent2.generation) + 1,
      parentIds: [parent1.id, parent2.id],
      createdAt: now,
    };

    const child2: Chromosome = {
      id: `brain_${now}_b`,
      strategyType: parent1.strategyType,
      genes: child2Genes,
      generation: Math.max(parent1.generation, parent2.generation) + 1,
      parentIds: [parent1.id, parent2.id],
      createdAt: now,
    };

    return [child1, child2];
  }

  /**
   * Gaussian mutation: for each gene, with probability mutationRate,
   * add noise drawn from N(0, range/6) and clamp to bounds.
   */
  mutate(chromosome: Chromosome, mutationRate: number = 0.2): Chromosome {
    const mutatedGenes = chromosome.genes.map(gene => {
      if (Math.random() > mutationRate) return { ...gene };

      const range = gene.max - gene.min;
      const sigma = range / 6; // ~99.7% of mutations within ±range/2
      const noise = this.gaussianRandom() * sigma;
      const newValue = snapToStep(gene.value + noise, gene.min, gene.max, gene.step);

      return { ...gene, value: newValue };
    });

    return { ...chromosome, genes: mutatedGenes };
  }

  /**
   * Generate a random chromosome for the initial population.
   */
  randomChromosome(strategyType: string): Chromosome {
    const templates = STRATEGY_GENES[strategyType];
    if (!templates) {
      throw new Error(`Unknown strategy type: ${strategyType}. Valid: ${Object.keys(STRATEGY_GENES).join(", ")}`);
    }

    const genes: Gene[] = templates.map(template => {
      const range = template.max - template.min;
      const rawValue = template.min + Math.random() * range;
      const value = snapToStep(rawValue, template.min, template.max, template.step);
      return { ...template, value };
    });

    return {
      id: `brain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      strategyType,
      genes,
      generation: 0,
      parentIds: [],
      createdAt: Date.now(),
    };
  }

  /** Box-Muller transform for Gaussian random numbers */
  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
}

export const geneticOperators = new GeneticOperators();
