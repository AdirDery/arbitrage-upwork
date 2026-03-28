import logger from "../core/logger.service";

/**
 * Simple logistic regression-based opportunity scorer.
 * Trains on historical paper trade outcomes to predict whether
 * a new opportunity will be profitable.
 *
 * Features: spread%, depth ratio, exchange volatility, time-of-day, fee impact
 * Target: was the trade profitable (1) or not (0)
 *
 * Uses a simple sigmoid-based model (no external ML library needed).
 */
export interface ScoringFeatures {
  spreadPct: number;       // (sellPrice - buyPrice) / buyPrice * 100
  depthRatio: number;      // min(buyDepth, sellDepth) / tradeSize — liquidity measure
  feeImpactPct: number;    // total fees as % of trade value
  hourOfDay: number;       // 0-23 (normalized to 0-1)
  volatility: number;      // recent price std dev (normalized)
  exchangePairScore: number; // historical success rate for this exchange pair
}

interface TrainingExample {
  features: number[];
  label: number; // 1 = profitable, 0 = not
}

export class OpportunityScorer {
  private weights: number[];
  private bias: number;
  private trained: boolean = false;
  private featureCount = 6;

  constructor() {
    // Initialize with small random weights
    this.weights = Array(this.featureCount).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    this.bias = 0;
  }

  /**
   * Train the model using gradient descent on historical data.
   * Each example is { features: number[], label: 0|1 }.
   */
  train(examples: TrainingExample[], epochs: number = 100, learningRate: number = 0.01): void {
    if (examples.length < 10) {
      logger.warn(`[OpportunityScorer] Need at least 10 examples to train, got ${examples.length}`);
      return;
    }

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      for (const example of examples) {
        const prediction = this.sigmoid(this.dotProduct(example.features) + this.bias);
        const error = prediction - example.label;
        totalLoss += Math.abs(error);

        // Gradient descent update
        for (let i = 0; i < this.featureCount; i++) {
          this.weights[i] -= learningRate * error * example.features[i];
        }
        this.bias -= learningRate * error;
      }

      if (epoch % 20 === 0) {
        const avgLoss = totalLoss / examples.length;
        logger.info(`[OpportunityScorer] Epoch ${epoch}: avg loss = ${avgLoss.toFixed(4)}`);
      }
    }

    this.trained = true;
    logger.info(`[OpportunityScorer] Training complete on ${examples.length} examples`);
  }

  /**
   * Predict probability that an opportunity will be profitable.
   * Returns { probability: 0-1, profitable: boolean }.
   */
  predict(features: ScoringFeatures): { probability: number; profitable: boolean } {
    const featureArray = this.extractFeatureArray(features);
    const probability = this.sigmoid(this.dotProduct(featureArray) + this.bias);
    return {
      probability,
      profitable: probability > 0.5,
    };
  }

  /**
   * Extract feature array from an opportunity's market data.
   */
  extractFeatures(
    buyPrice: number,
    sellPrice: number,
    tradeSize: number,
    buyDepth: number,
    sellDepth: number,
    buyFee: number,
    sellFee: number,
    recentVolatility: number = 0,
    exchangePairWinRate: number = 0.5
  ): ScoringFeatures {
    const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;
    const depthRatio = Math.min(buyDepth, sellDepth) / tradeSize;
    const feeImpactPct = (buyFee + sellFee) * 100;
    const hourOfDay = new Date().getUTCHours() / 24;

    return {
      spreadPct,
      depthRatio: Math.min(depthRatio, 10), // cap at 10x
      feeImpactPct,
      hourOfDay,
      volatility: Math.min(recentVolatility, 5),
      exchangePairScore: exchangePairWinRate,
    };
  }

  /**
   * Convert ScoringFeatures to a normalized array for the model.
   */
  private extractFeatureArray(f: ScoringFeatures): number[] {
    return [
      f.spreadPct / 2,           // normalize: 0-2% -> 0-1
      f.depthRatio / 10,         // normalize: 0-10x -> 0-1
      f.feeImpactPct / 0.5,     // normalize: 0-0.5% -> 0-1
      f.hourOfDay,               // already 0-1
      f.volatility / 5,          // normalize: 0-5 -> 0-1
      f.exchangePairScore,       // already 0-1
    ];
  }

  /** Get model accuracy on a test set */
  evaluate(testExamples: TrainingExample[]): { accuracy: number; precision: number; recall: number } {
    let correct = 0;
    let truePos = 0;
    let falsePos = 0;
    let falseNeg = 0;

    for (const ex of testExamples) {
      const pred = this.sigmoid(this.dotProduct(ex.features) + this.bias) > 0.5 ? 1 : 0;
      if (pred === ex.label) correct++;
      if (pred === 1 && ex.label === 1) truePos++;
      if (pred === 1 && ex.label === 0) falsePos++;
      if (pred === 0 && ex.label === 1) falseNeg++;
    }

    return {
      accuracy: correct / testExamples.length,
      precision: truePos / (truePos + falsePos || 1),
      recall: truePos / (truePos + falseNeg || 1),
    };
  }

  isReady(): boolean { return this.trained; }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private dotProduct(features: number[]): number {
    let sum = 0;
    for (let i = 0; i < this.weights.length; i++) {
      sum += (this.weights[i] || 0) * (features[i] || 0);
    }
    return sum;
  }
}

export const opportunityScorer = new OpportunityScorer();
