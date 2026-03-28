export interface StrategyMetadata {
  id: string;
  name: string;
  type: "direct" | "triangular" | "funding" | "statistical" | "altcoin";
  riskLevel: "low" | "medium" | "high";
  description: string;
}

export interface OpportunityScore {
  profitEstimate: number; // estimated USD profit
  confidence: number;     // 0-1 how confident we are
  riskScore: number;      // 0-1 (1 = highest risk)
  urgency: number;        // 0-1 (1 = must act immediately)
}

export interface TradeLeg {
  exchange: string;
  symbol: string;
  side: "BUY" | "SELL";
  size: number;
  expectedPrice: number;
}

export interface Opportunity {
  id: string;
  strategyId: string;
  timestamp: number;
  exchanges: string[];
  symbols: string[];
  legs: TradeLeg[];
  estimatedProfit: number;
  estimatedROI: number;
  score: OpportunityScore;
  metadata: Record<string, any>;
}

export interface LegResult {
  orderId: string;
  exchange: string;
  symbol: string;
  side: "BUY" | "SELL";
  requestedSize: number;
  filledSize: number;
  avgPrice: number;
  fee: number;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
}

export interface ExecutionResult {
  success: boolean;
  opportunityId: string;
  legs: LegResult[];
  actualProfit: number;
  actualROI: number;
  executionTimeMs: number;
  error?: string;
}

export interface StrategyConfig {
  [key: string]: any;
}

export interface IStrategy {
  readonly metadata: StrategyMetadata;

  /** Initialize strategy with config */
  initialize(config: StrategyConfig): Promise<void>;

  /** Scan for opportunities, return all found */
  scan(): Promise<Opportunity[]>;

  /** Score/evaluate a specific opportunity */
  evaluate(opportunity: Opportunity): Promise<OpportunityScore>;

  /** Execute a trade opportunity */
  execute(opportunity: Opportunity): Promise<ExecutionResult>;

  /** Get current strategy configuration */
  getConfig(): StrategyConfig;

  /** Update strategy parameters (partial update) */
  updateConfig(config: Partial<StrategyConfig>): void;

  /** Cleanup resources */
  dispose(): Promise<void>;
}
