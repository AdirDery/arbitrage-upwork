import mongoose, { Schema } from "mongoose";
import logger from "../core/logger.service";

export interface LedgerSnapshot {
  exchange: string;
  balances: Record<string, number>;
  timestamp: number;
}

// MongoDB model for persisting ledger snapshots
const PaperLedgerSchema = new Schema({
  snapshotId: { type: String, required: true, unique: true },
  balances: { type: Schema.Types.Mixed, required: true }, // { exchange: { asset: amount } }
  createdAt: { type: Date, default: Date.now },
});

export const PaperLedgerModel = mongoose.model("PaperLedger", PaperLedgerSchema);

/**
 * Tracks virtual balances per exchange per asset.
 * All paper trades debit/credit this ledger instead of real exchange accounts.
 */
export class PaperLedger {
  // exchange -> asset -> amount
  private balances: Map<string, Map<string, number>> = new Map();
  private readonly snapshotId: string;

  constructor(
    private initialCapital: Record<string, Record<string, number>>,
    snapshotId?: string
  ) {
    this.snapshotId = snapshotId || `ledger_${Date.now()}`;
    this.reset();
  }

  /** Reset balances to initial capital */
  reset(): void {
    this.balances.clear();
    for (const [exchange, assets] of Object.entries(this.initialCapital)) {
      const assetMap = new Map<string, number>();
      for (const [asset, amount] of Object.entries(assets)) {
        assetMap.set(asset, amount);
      }
      this.balances.set(exchange, assetMap);
    }
    logger.info(`[PaperLedger] Reset to initial capital`);
  }

  /** Credit (add) an amount to an exchange/asset balance */
  credit(exchange: string, asset: string, amount: number): void {
    if (!this.balances.has(exchange)) {
      this.balances.set(exchange, new Map());
    }
    const assets = this.balances.get(exchange)!;
    const current = assets.get(asset) || 0;
    assets.set(asset, current + amount);
  }

  /** Debit (subtract) an amount. Returns false if insufficient balance. */
  debit(exchange: string, asset: string, amount: number): boolean {
    const assets = this.balances.get(exchange);
    if (!assets) return false;

    const current = assets.get(asset) || 0;
    if (current < amount) {
      logger.warn(`[PaperLedger] Insufficient ${asset} on ${exchange}: have ${current}, need ${amount}`);
      return false;
    }

    assets.set(asset, current - amount);
    return true;
  }

  /** Get balance for a specific exchange/asset */
  getBalance(exchange: string, asset: string): number {
    return this.balances.get(exchange)?.get(asset) || 0;
  }

  /** Get all balances for an exchange */
  getExchangeBalances(exchange: string): Record<string, number> {
    const assets = this.balances.get(exchange);
    if (!assets) return {};
    const result: Record<string, number> = {};
    for (const [asset, amount] of assets) {
      if (amount > 0) result[asset] = amount;
    }
    return result;
  }

  /** Get all balances across all exchanges */
  getAllBalances(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [exchange, assets] of this.balances) {
      result[exchange] = {};
      for (const [asset, amount] of assets) {
        if (amount > 0) result[exchange][asset] = amount;
      }
    }
    return result;
  }

  /** Calculate total portfolio value in USDT (approximate — uses balance values) */
  getTotalValueUSDT(): number {
    let total = 0;
    for (const [, assets] of this.balances) {
      // Only count USDT directly; other assets would need price conversion
      total += assets.get("USDT") || 0;
    }
    return total;
  }

  /** Persist current state to MongoDB */
  async save(): Promise<void> {
    const balances = this.getAllBalances();
    await PaperLedgerModel.findOneAndUpdate(
      { snapshotId: this.snapshotId },
      { snapshotId: this.snapshotId, balances, createdAt: new Date() },
      { upsert: true }
    );
  }

  /** Restore from MongoDB */
  async restore(): Promise<boolean> {
    const snapshot = await PaperLedgerModel.findOne({ snapshotId: this.snapshotId });
    if (!snapshot) return false;

    this.balances.clear();
    const saved = snapshot.balances as Record<string, Record<string, number>>;
    for (const [exchange, assets] of Object.entries(saved)) {
      const assetMap = new Map<string, number>();
      for (const [asset, amount] of Object.entries(assets)) {
        assetMap.set(asset, amount);
      }
      this.balances.set(exchange, assetMap);
    }
    logger.info(`[PaperLedger] Restored from snapshot ${this.snapshotId}`);
    return true;
  }
}
