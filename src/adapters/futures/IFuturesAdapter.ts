/**
 * Interface for perpetual futures exchange adapters.
 * Extends spot trading capabilities with leverage, positions, and funding rates.
 */
export interface IFuturesAdapter {
  readonly name: string;

  /** Get current funding rate for a symbol (e.g., 0.0001 = 0.01%) */
  getFundingRate(symbol: string): Promise<FundingRateInfo>;

  /** Get predicted/next funding rate */
  getNextFundingRate(symbol: string): Promise<number>;

  /** Open a short position (for funding rate arb: spot long + futures short) */
  openShort(symbol: string, size: number, leverage?: number): Promise<FuturesOrderResult>;

  /** Close a position */
  closePosition(symbol: string): Promise<FuturesOrderResult>;

  /** Get current open position info */
  getPositionInfo(symbol: string): Promise<PositionInfo | null>;

  /** Get futures orderbook */
  getFuturesOrderbook(symbol: string): Promise<{ bids: [number, number][]; asks: [number, number][] }>;

  /** Get available margin/balance for futures trading */
  getFuturesBalance(): Promise<Record<string, number>>;
}

export interface FundingRateInfo {
  symbol: string;
  currentRate: number;       // current funding rate (e.g., 0.0001)
  nextRate: number;          // predicted next rate
  nextFundingTime: number;   // timestamp of next funding
  interval: number;          // funding interval in hours (usually 8)
}

export interface FuturesOrderResult {
  success: boolean;
  orderId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  avgPrice: number;
  error?: string;
}

export interface PositionInfo {
  symbol: string;
  side: "LONG" | "SHORT" | "NONE";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  marginUsed: number;
}
