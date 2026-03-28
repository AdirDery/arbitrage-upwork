/**
 * A Gene represents a single tunable parameter of a trading strategy.
 * Genes are bounded, discretized, and named for interpretability.
 */
export interface Gene {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number; // discretization step (e.g., 0.1 for profit threshold)
}

/**
 * A Chromosome is a collection of genes encoding a complete strategy configuration.
 * Two chromosomes can be crossed over and mutated to produce offspring.
 */
export interface Chromosome {
  id: string;
  strategyType: string;
  genes: Gene[];
  generation: number;
  parentIds: string[];
  createdAt: number;
}

/** Gene templates for DirectArbitrageStrategy */
export const DIRECT_ARB_GENES: Omit<Gene, "value">[] = [
  { name: "tradeSize",        min: 0.01, max: 5,    step: 0.01 },  // base currency amount
  { name: "profitThreshold",  min: 0.05, max: 5,    step: 0.05 },  // min USD profit
  { name: "scanInterval",     min: 500,  max: 10000, step: 500 },   // ms between scans
  { name: "minSpreadPct",     min: 0.01, max: 1.0,  step: 0.01 },  // minimum spread % to consider
  { name: "maxSlippagePct",   min: 0.05, max: 1.0,  step: 0.05 },  // max acceptable slippage %
  // Exchange pair weights (0 = skip, 1 = always scan)
  { name: "weight_Binance",   min: 0, max: 1, step: 0.1 },
  { name: "weight_Bybit",     min: 0, max: 1, step: 0.1 },
  { name: "weight_Okx",       min: 0, max: 1, step: 0.1 },
  { name: "weight_Mexc",      min: 0, max: 1, step: 0.1 },
  { name: "weight_Bingx",     min: 0, max: 1, step: 0.1 },
];

/** Gene templates for TriangularArbitrageStrategy */
export const TRIANGULAR_ARB_GENES: Omit<Gene, "value">[] = [
  { name: "capital",           min: 50,  max: 5000, step: 50 },    // USDT per trade
  { name: "profitThreshold",   min: 0.1, max: 10,   step: 0.1 },
  { name: "scanInterval",      min: 500, max: 10000, step: 500 },
  { name: "weight_Binance",    min: 0, max: 1, step: 0.1 },
  { name: "weight_Bybit",      min: 0, max: 1, step: 0.1 },
  { name: "weight_Okx",        min: 0, max: 1, step: 0.1 },
  { name: "weight_Mexc",       min: 0, max: 1, step: 0.1 },
  { name: "weight_Bingx",      min: 0, max: 1, step: 0.1 },
];

/** Convert a chromosome's genes to a key-value config object */
export function chromosomeToConfig(chromosome: Chromosome): Record<string, number> {
  const config: Record<string, number> = {};
  for (const gene of chromosome.genes) {
    config[gene.name] = gene.value;
  }
  return config;
}

/** Snap a value to the nearest step within bounds */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(clamped / step) * step;
}
