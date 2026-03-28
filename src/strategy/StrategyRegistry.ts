import { IStrategy } from "./IStrategy";
import logger from "../core/logger.service";

/**
 * Manages all active strategy instances. Strategies can be registered,
 * started, stopped, and queried. The evolution engine uses this to
 * manage populations of competing brains.
 */
export class StrategyRegistry {
  private strategies: Map<string, IStrategy> = new Map();
  private running: Set<string> = new Set();

  register(strategy: IStrategy): void {
    const id = strategy.metadata.id;
    if (this.strategies.has(id)) {
      logger.warn(`[StrategyRegistry] Strategy ${id} already registered, replacing`);
    }
    this.strategies.set(id, strategy);
    logger.info(`[StrategyRegistry] Registered: ${strategy.metadata.name} (${id})`);
  }

  unregister(id: string): void {
    const strategy = this.strategies.get(id);
    if (strategy) {
      if (this.running.has(id)) {
        logger.warn(`[StrategyRegistry] Stopping running strategy ${id} before unregistering`);
        this.running.delete(id);
      }
      strategy.dispose();
      this.strategies.delete(id);
      logger.info(`[StrategyRegistry] Unregistered: ${id}`);
    }
  }

  get(id: string): IStrategy | undefined {
    return this.strategies.get(id);
  }

  getAll(): IStrategy[] {
    return Array.from(this.strategies.values());
  }

  getRunning(): IStrategy[] {
    return Array.from(this.running).map(id => this.strategies.get(id)!).filter(Boolean);
  }

  markRunning(id: string): void {
    this.running.add(id);
  }

  markStopped(id: string): void {
    this.running.delete(id);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  size(): number {
    return this.strategies.size;
  }

  async disposeAll(): Promise<void> {
    for (const [id, strategy] of this.strategies) {
      await strategy.dispose();
    }
    this.strategies.clear();
    this.running.clear();
    logger.info("[StrategyRegistry] All strategies disposed");
  }
}

export const strategyRegistry = new StrategyRegistry();
