/**
 * Simulates market order fills against live orderbook snapshots.
 * Used by PaperExchangeAdapter to produce realistic paper trade results.
 */
export interface SimulatedFill {
  filledSize: number;
  avgPrice: number;
  totalCost: number;   // total quote spent (for buys) or received (for sells)
  fee: number;
  complete: boolean;    // true if entire order was filled
}

export interface SimulatorConfig {
  slippageBps: number;   // extra slippage in basis points (100 bps = 1%)
  feeRate: number;       // taker fee rate (e.g., 0.001 = 0.1%)
}

export class OrderSimulator {
  constructor(private config: SimulatorConfig = { slippageBps: 5, feeRate: 0.001 }) {}

  /**
   * Simulate a market buy order against an orderbook's ask side.
   * Walks the ask levels to fill the requested quantity.
   */
  simulateBuy(
    asks: [number, number][],  // [price, quantity] sorted ascending
    size: number               // base quantity to buy
  ): SimulatedFill {
    return this.walkBook(asks, size);
  }

  /**
   * Simulate a market sell order against an orderbook's bid side.
   * Walks the bid levels to fill the requested quantity.
   */
  simulateSell(
    bids: [number, number][],  // [price, quantity] sorted descending
    size: number               // base quantity to sell
  ): SimulatedFill {
    return this.walkBook(bids, size);
  }

  private walkBook(levels: [number, number][], size: number): SimulatedFill {
    let remaining = size;
    let totalCost = 0;
    let filled = 0;

    for (const [price, qty] of levels) {
      if (remaining <= 0) break;

      const take = Math.min(qty, remaining);
      // Apply extra slippage: slightly worse price
      const slippageMultiplier = 1 + (this.config.slippageBps / 10000);
      const effectivePrice = price * slippageMultiplier;

      totalCost += take * effectivePrice;
      filled += take;
      remaining -= take;
    }

    const complete = remaining <= 1e-12;
    const avgPrice = filled > 0 ? totalCost / filled : 0;
    const fee = totalCost * this.config.feeRate;

    return {
      filledSize: filled,
      avgPrice,
      totalCost,
      fee,
      complete,
    };
  }
}
