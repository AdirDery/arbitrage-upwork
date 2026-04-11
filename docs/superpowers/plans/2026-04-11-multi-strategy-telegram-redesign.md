# Multi-Strategy Paper/Evolution + Telegram UI Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all 5 strategies (direct, triangular, altcoin, funding rate, statistical) into paper trading and evolution engine, then redesign all Telegram messages with professional visual formatting.

**Architecture:** Paper trading launches all 5 strategies in parallel via a `MultiStrategyPaperEngine`. Evolution engine gets gene templates for all 5 strategy types so brains can evolve any strategy. Telegram messages get a visual overhaul with consistent card-style formatting, progress bars, and structured layouts.

**Tech Stack:** TypeScript, Telegram Bot API (MarkdownV2), MongoDB, existing strategy implementations

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/evolution/Chromosome.ts` | Modify | Add gene templates for altcoin, funding, statistical strategies |
| `src/evolution/GeneticOperators.ts` | Modify | Support all 5 strategy types in `randomChromosome()` |
| `src/evolution/Brain.ts` | Modify | Create any of 5 strategy types from chromosome |
| `src/evolution/Population.ts` | Modify | Support mixed-strategy populations |
| `src/telegram/telegram.controller.ts` | Modify | Multi-strategy paper, evolution with strategy picker, all visual redesign |

---

### Task 1: Add Gene Templates for New Strategies

**Files:**
- Modify: `src/evolution/Chromosome.ts`

- [ ] **Step 1: Add altcoin, funding, and statistical gene templates**

Add after the existing `TRIANGULAR_ARB_GENES` (line 51):

```typescript
/** Gene templates for AltcoinArbitrageStrategy */
export const ALTCOIN_ARB_GENES: Omit<Gene, "value">[] = [
  { name: "tradeSize",       min: 10,   max: 500,   step: 10 },    // USDT per trade
  { name: "profitThreshold", min: 0.1,  max: 5,     step: 0.1 },   // min USD profit
  { name: "minSpreadPct",    min: 0.1,  max: 3.0,   step: 0.1 },   // minimum spread %
  { name: "scanInterval",    min: 1000, max: 15000,  step: 1000 },  // ms between scans
  { name: "maxSlippagePct",  min: 0.1,  max: 2.0,   step: 0.1 },
  { name: "weight_Binance",  min: 0, max: 1, step: 0.1 },
  { name: "weight_Bybit",    min: 0, max: 1, step: 0.1 },
  { name: "weight_Okx",      min: 0, max: 1, step: 0.1 },
  { name: "weight_Mexc",     min: 0, max: 1, step: 0.1 },
  { name: "weight_Bingx",    min: 0, max: 1, step: 0.1 },
];

/** Gene templates for FundingRateStrategy */
export const FUNDING_RATE_GENES: Omit<Gene, "value">[] = [
  { name: "capitalPerPosition",   min: 100,   max: 5000,  step: 100 },
  { name: "minFundingRate",       min: 0.0001, max: 0.005, step: 0.0001 },
  { name: "maxPositions",         min: 1,     max: 5,     step: 1 },
  { name: "closeAfterReversals",  min: 1,     max: 5,     step: 1 },
  { name: "scanInterval",         min: 5000,  max: 60000, step: 5000 },
];

/** Gene templates for StatisticalArbitrageStrategy */
export const STAT_ARB_GENES: Omit<Gene, "value">[] = [
  { name: "tradeSize",        min: 50,  max: 2000, step: 50 },
  { name: "zScoreThreshold",  min: 1.0, max: 4.0,  step: 0.1 },
  { name: "minCorrelation",   min: 0.5, max: 0.95, step: 0.05 },
  { name: "scanInterval",     min: 2000, max: 30000, step: 2000 },
];

/** Map strategy type to its gene templates */
export const STRATEGY_GENES: Record<string, Omit<Gene, "value">[]> = {
  direct: DIRECT_ARB_GENES,
  triangular: TRIANGULAR_ARB_GENES,
  altcoin: ALTCOIN_ARB_GENES,
  funding: FUNDING_RATE_GENES,
  statistical: STAT_ARB_GENES,
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/evolution/Chromosome.ts
git commit -m "feat: add gene templates for altcoin, funding, and statistical strategies"
```

---

### Task 2: Update GeneticOperators to Support All Strategies

**Files:**
- Modify: `src/evolution/GeneticOperators.ts`

- [ ] **Step 1: Update randomChromosome to use STRATEGY_GENES map**

Replace the import on line 1:
```typescript
import { Chromosome, Gene, snapToStep, STRATEGY_GENES } from "./Chromosome";
```

Replace `randomChromosome` method (lines 90-108):
```typescript
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/evolution/GeneticOperators.ts
git commit -m "feat: GeneticOperators supports all 5 strategy types"
```

---

### Task 3: Update Brain to Create All 5 Strategy Types

**Files:**
- Modify: `src/evolution/Brain.ts`

- [ ] **Step 1: Add imports for missing strategies**

Add after existing imports (line 6):
```typescript
import { AltcoinArbitrageStrategy, ALTCOIN_SYMBOLS } from "../strategy/implementations/AltcoinArbitrageStrategy";
import { FundingRateStrategy } from "../strategy/implementations/FundingRateStrategy";
import { StatisticalArbitrageStrategy } from "../strategy/implementations/StatisticalArbitrageStrategy";
```

- [ ] **Step 2: Add strategy creation for altcoin, funding, statistical in start()**

Replace the strategy creation block (lines 70-87) with:

```typescript
    if (this.chromosome.strategyType === "direct") {
      const strategy = new DirectArbitrageStrategy(this.id);
      await strategy.initialize({
        exchanges: activeExchanges,
        symbols: this.allSymbols,
        tradeSize: config.tradeSize || 0.5,
        profitThreshold: config.profitThreshold || 0.5,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "triangular") {
      const strategy = new TriangularArbitrageStrategy(this.id);
      await strategy.initialize({
        allExchanges: paperAdapters as any,
        capital: config.capital || 200,
        profitThreshold: config.profitThreshold || 0.5,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "altcoin") {
      const strategy = new AltcoinArbitrageStrategy(this.id);
      await strategy.initialize({
        exchanges: activeExchanges,
        symbols: ALTCOIN_SYMBOLS,
        tradeSize: config.tradeSize || 50,
        profitThreshold: config.profitThreshold || 0.3,
        minSpreadPct: config.minSpreadPct || 0.3,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "funding") {
      // Funding rate requires futures adapters — skip if none available
      const strategy = new FundingRateStrategy(this.id);
      await strategy.initialize({
        spotAdapters: paperAdapters as any,
        futuresAdapters: {}, // futures adapters injected separately
        symbols: this.allSymbols,
        minFundingRate: config.minFundingRate || 0.0003,
        capitalPerPosition: config.capitalPerPosition || 500,
        maxPositions: config.maxPositions || 3,
        closeAfterReversals: config.closeAfterReversals || 2,
      });
      this.strategy = strategy;
    } else if (this.chromosome.strategyType === "statistical") {
      const strategy = new StatisticalArbitrageStrategy(this.id);
      const exchangeName = Object.keys(paperAdapters)[0] || "Binance";
      await strategy.initialize({
        exchanges: activeExchanges,
        tradeSize: config.tradeSize || 200,
        zScoreThreshold: config.zScoreThreshold || 2.0,
        minCorrelation: config.minCorrelation || 0.7,
        exchange: exchangeName,
      });
      this.strategy = strategy;
    }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/evolution/Brain.ts
git commit -m "feat: Brain supports all 5 strategy types"
```

---

### Task 4: Update Population for Mixed-Strategy Support

**Files:**
- Modify: `src/evolution/Population.ts`

- [ ] **Step 1: Update PopulationConfig to support multiple strategy types**

Replace the `strategyType` field in `PopulationConfig` (line 14):
```typescript
  strategyType: string;         // "direct" | "triangular" | "altcoin" | "funding" | "statistical" | "mixed"
```

- [ ] **Step 2: Update initialize() to support mixed populations**

Replace `initialize` method (lines 42-53):
```typescript
  async initialize(): Promise<void> {
    const { populationSize, strategyType } = this.config;
    logger.info(`[Population] Initializing ${populationSize} brains for ${strategyType}`);

    const STRATEGY_TYPES = ["direct", "triangular", "altcoin", "statistical"];
    this.brains = [];

    for (let i = 0; i < populationSize; i++) {
      let type: string;
      if (strategyType === "mixed") {
        // Distribute brains across strategies evenly
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/evolution/Population.ts
git commit -m "feat: Population supports mixed-strategy evolution"
```

---

### Task 5: Multi-Strategy Paper Trading + Telegram Visual Redesign

**Files:**
- Modify: `src/telegram/telegram.controller.ts`

This is the largest task — it rewrites `handlePaperStart` to launch all strategies, updates `handleEvoStart` to offer strategy selection, and redesigns ALL Telegram message formatting.

- [ ] **Step 1: Add missing imports at top of file**

Add after existing imports (line 19):
```typescript
import { AltcoinArbitrageStrategy, ALTCOIN_SYMBOLS } from "../strategy/implementations/AltcoinArbitrageStrategy";
import { TriangularArbitrageStrategy } from "../strategy/implementations/TriangularArbitrageStrategy";
import { StatisticalArbitrageStrategy } from "../strategy/implementations/StatisticalArbitrageStrategy";
import { IStrategy } from "../strategy/IStrategy";
```

- [ ] **Step 2: Add paperStrategies array to class fields**

Add after `private evolutionEngine` field (line 31):
```typescript
  private paperStrategies: IStrategy[] = [];
```

- [ ] **Step 3: Rewrite handlePaperStart for multi-strategy**

Replace `handlePaperStart` (lines 507-553) with:
```typescript
  private async handlePaperStart(chatId: number) {
    try {
      if (this.paperEngine) {
        await this.bot.sendMessage({
          chat_id: chatId,
          text: "⚠️ Paper trading is already running\\. Use /paper\\_stop first\\.",
          parse_mode: "MarkdownV2",
        });
        return;
      }

      await this.bot.sendMessage({
        chat_id: chatId,
        text: "⏳ *Initializing paper trading\\.\\.\\.*\n\nStarting all strategies with live market data\\.",
        parse_mode: "MarkdownV2",
      });

      // Create paper engine with $10K virtual capital per exchange
      const initialCapital: Record<string, Record<string, number>> = {};
      for (const name of Object.keys(this.allExchanges)) {
        initialCapital[name] = { USDT: 10000 };
      }

      this.paperEngine = new PaperTradingEngine(this.allExchanges, { initialCapital });
      this.paperStrategies = [];

      const user = await UserPreferences.findOne();
      const selectedSymbols = user?.selectedSymbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
      const selectedExchangeNames = user?.selectedExchanges || Object.keys(this.allExchanges);
      const config = await Config.findOne();

      const paperAdapters = this.paperEngine.getAllAdapters();
      const exchanges = selectedExchangeNames
        .map(name => paperAdapters[name])
        .filter(Boolean) as any[];

      // Strategy 1: Direct Arbitrage
      const directStrat = new DirectArbitrageStrategy("paper_direct");
      await directStrat.initialize({
        exchanges,
        symbols: selectedSymbols,
        tradeSize: config?.directArbSize || 0.5,
        profitThreshold: config?.profitThreshold || 0.5,
      });
      this.paperStrategies.push(directStrat);

      // Strategy 2: Altcoin Arbitrage
      const altcoinStrat = new AltcoinArbitrageStrategy("paper_altcoin");
      await altcoinStrat.initialize({
        exchanges,
        symbols: ALTCOIN_SYMBOLS,
        tradeSize: 50,
        profitThreshold: 0.3,
        minSpreadPct: 0.3,
      });
      this.paperStrategies.push(altcoinStrat);

      // Strategy 3: Triangular Arbitrage
      const triStrat = new TriangularArbitrageStrategy("paper_triangular");
      await triStrat.initialize({
        allExchanges: paperAdapters as any,
        capital: config?.triangularArbSize || 200,
        profitThreshold: config?.profitThreshold || 0.5,
      });
      this.paperStrategies.push(triStrat);

      // Strategy 4: Statistical Arbitrage
      const statStrat = new StatisticalArbitrageStrategy("paper_stat");
      const firstExchange = selectedExchangeNames[0] || "Binance";
      await statStrat.initialize({
        exchanges,
        tradeSize: 200,
        zScoreThreshold: 2.0,
        minCorrelation: 0.7,
        exchange: firstExchange,
      });
      this.paperStrategies.push(statStrat);

      // Start all strategies in parallel
      for (const strategy of this.paperStrategies) {
        this.paperEngine.startStrategy(strategy, 3000);
      }

      const stratList = this.paperStrategies.map(s => s.metadata.name).join(", ");

      const msg =
`╔══════════════════════════════════╗
║     📊 PAPER TRADING STARTED     ║
╚══════════════════════════════════╝

💰 *Capital:* $10,000 per exchange
🔄 *Scan Interval:* Every 3 seconds
📡 *Exchanges:* ${selectedExchangeNames.length} connected

━━━━━━ Active Strategies ━━━━━━

📈 Direct Arbitrage
🔺 Triangular Arbitrage
🪙 Altcoin Arbitrage (${ALTCOIN_SYMBOLS.length} pairs)
📊 Statistical Arbitrage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 /paper\\_status — Check P\\&L
🛑 /paper\\_stop — Stop trading
🔄 /paper\\_reset — Reset balances`;

      await this.bot.sendMessage({
        chat_id: chatId,
        text: msg,
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      console.error(`[Telegram Controller] Paper start error:`, error);
      await this.bot.sendMessage({ chat_id: chatId, text: "❌ Error starting paper trading\\." , parse_mode: "MarkdownV2" });
    }
  }
```

- [ ] **Step 4: Rewrite handlePaperStop with visual design**

Replace `handlePaperStop` (lines 555-574):
```typescript
  private async handlePaperStop(chatId: number) {
    if (!this.paperEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "⚠️ Paper trading is not running\\.", parse_mode: "MarkdownV2" });
      return;
    }

    this.paperEngine.stop();
    await this.paperEngine.savePerformanceSnapshot();

    const results = this.paperEngine.getResults();
    const pnlSign = results.totalPnL >= 0 ? "\\+" : "";
    const pnlEmoji = results.totalPnL >= 0 ? "🟢" : "🔴";

    // Build strategy breakdown from trades
    const stratBreakdown = new Map<string, { count: number; pnl: number }>();
    for (const t of results.trades) {
      const existing = stratBreakdown.get(t.strategyId) || { count: 0, pnl: 0 };
      existing.count++;
      existing.pnl += t.profit;
      stratBreakdown.set(t.strategyId, existing);
    }

    let stratLines = "";
    for (const [id, data] of stratBreakdown) {
      const icon = data.pnl >= 0 ? "🟢" : "🔴";
      const name = id.replace("paper_", "");
      stratLines += `${icon} *${this.escMd(this.capitalize(name))}:* ${data.count} trades \\| $${this.escMd(data.pnl.toFixed(2))}\n`;
    }
    if (!stratLines) stratLines = "No trades executed\n";

    const msg =
`╔══════════════════════════════════╗
║     🛑 PAPER TRADING STOPPED     ║
╚══════════════════════════════════╝

${pnlEmoji} *Total P&L:* $${this.escMd(pnlSign)}${this.escMd(results.totalPnL.toFixed(4))}
📊 *Total Trades:* ${results.totalTrades}
✅ *Win Rate:* ${this.escMd((results.winRate * 100).toFixed(1))}%

━━━━━━ Strategy Breakdown ━━━━━━

${stratLines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
    this.paperEngine = null;
    this.paperStrategies = [];
  }
```

- [ ] **Step 5: Rewrite handlePaperStatus with visual design**

Replace `handlePaperStatus` (lines 576-603):
```typescript
  private async handlePaperStatus(chatId: number) {
    if (!this.paperEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "⚠️ Paper trading is not running\\. Use /paper\\_start", parse_mode: "MarkdownV2" });
      return;
    }

    const results = this.paperEngine.getResults();
    const balances = results.balances;
    const pnlEmoji = results.totalPnL >= 0 ? "🟢" : "🔴";
    const pnlSign = results.totalPnL >= 0 ? "\\+" : "";

    // Balance per exchange
    let balanceLines = "";
    for (const [exchange, assets] of Object.entries(balances)) {
      const usdtBal = assets["USDT"] || 0;
      const change = usdtBal - 10000;
      const changeIcon = change >= 0 ? "▲" : "▼";
      balanceLines += `  ${this.escMd(exchange)}: $${this.escMd(usdtBal.toFixed(2))} ${changeIcon}\n`;
    }

    // Strategy breakdown
    const stratBreakdown = new Map<string, { count: number; pnl: number }>();
    for (const t of results.trades) {
      const existing = stratBreakdown.get(t.strategyId) || { count: 0, pnl: 0 };
      existing.count++;
      existing.pnl += t.profit;
      stratBreakdown.set(t.strategyId, existing);
    }

    let stratLines = "";
    for (const [id, data] of stratBreakdown) {
      const icon = data.pnl >= 0 ? "🟢" : "🔴";
      const name = id.replace("paper_", "");
      stratLines += `  ${icon} ${this.escMd(this.capitalize(name))}: ${data.count} trades \\| $${this.escMd(data.pnl.toFixed(2))}\n`;
    }
    if (!stratLines) stratLines = "  No trades yet\\.\\.\\.\n";

    // Recent trades
    const recentTrades = results.trades.slice(-5).map(t => {
      const icon = t.profit > 0 ? "✅" : "❌";
      return `  ${icon} $${this.escMd(t.profit.toFixed(4))} \\| ${this.escMd(t.legs.map(l => l.exchange).join(" → "))}`;
    }).join("\n");

    // Win rate bar
    const barLength = 10;
    const filled = Math.round(results.winRate * barLength);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

    const msg =
`╔══════════════════════════════════╗
║      📊 PAPER TRADING STATUS     ║
╚══════════════════════════════════╝

${pnlEmoji} *P&L:* $${this.escMd(pnlSign)}${this.escMd(results.totalPnL.toFixed(4))}
📊 *Trades:* ${results.totalTrades}
🎯 *Win Rate:* ${this.escMd(bar)} ${this.escMd((results.winRate * 100).toFixed(1))}%

━━━━ Strategy Performance ━━━━

${stratLines}
━━━━━ Exchange Balances ━━━━━

${balanceLines}
━━━━━━ Recent Trades ━━━━━━

${recentTrades || "  No trades yet"}`;

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
  }
```

- [ ] **Step 6: Rewrite handlePaperReset with visual design**

Replace `handlePaperReset` (lines 605-616):
```typescript
  private async handlePaperReset(chatId: number) {
    if (this.paperEngine) {
      this.paperEngine.stop();
      await this.paperEngine.reset();
      this.paperEngine = null;
      this.paperStrategies = [];
    }

    await this.bot.sendMessage({
      chat_id: chatId,
      text:
`╔══════════════════════════════════╗
║    🔄 PAPER TRADING RESET        ║
╚══════════════════════════════════╝

💰 Virtual balances restored to $10,000
📊 Trade history cleared

Use /paper\\_start to begin again\\.`,
      parse_mode: "MarkdownV2",
    });
  }
```

- [ ] **Step 7: Rewrite handleEvoStart with mixed strategy support + visual design**

Replace `handleEvoStart` (lines 620-649):
```typescript
  private async handleEvoStart(chatId: number) {
    try {
      if (this.evolutionEngine) {
        await this.bot.sendMessage({ chat_id: chatId, text: "⚠️ Evolution is already running\\. Use /evo\\_stop first\\.", parse_mode: "MarkdownV2" });
        return;
      }

      const user = await UserPreferences.findOne();
      const symbols = user?.selectedSymbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

      this.evolutionEngine = new EvolutionEngine(this.allExchanges, symbols);
      await this.evolutionEngine.start({
        populationSize: 12,
        eliteCount: 2,
        mutationRate: 0.2,
        crossoverRate: 0.7,
        tournamentSize: 3,
        strategyType: "mixed",
      });

      const msg =
`╔══════════════════════════════════╗
║   🧬 EVOLUTION ENGINE STARTED    ║
╚══════════════════════════════════╝

🧠 *Population:* 12 brains
🔀 *Mode:* Mixed Strategies
⏱ *Eval Period:* 24 hours
🏆 *Elite:* Top 2 survive each generation

━━━━━ Strategy Distribution ━━━━━

📈 3x Direct Arbitrage
🔺 3x Triangular Arbitrage
🪙 3x Altcoin Arbitrage
📊 3x Statistical Arbitrage

━━━━━━━ Genetic Config ━━━━━━━

🧬 Crossover Rate: 70%
💥 Mutation Rate: 20%
⚔️ Tournament Size: 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 /evo\\_status — View leaderboard
🛑 /evo\\_stop — Stop evolution`;

      await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
    } catch (error) {
      console.error(`[Telegram Controller] Evolution start error:`, error);
      await this.bot.sendMessage({ chat_id: chatId, text: "❌ Error starting evolution engine\\.", parse_mode: "MarkdownV2" });
    }
  }
```

- [ ] **Step 8: Rewrite handleEvoStop with visual design**

Replace `handleEvoStop` (lines 651-683):
```typescript
  private async handleEvoStop(chatId: number) {
    if (!this.evolutionEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "⚠️ Evolution is not running\\.", parse_mode: "MarkdownV2" });
      return;
    }

    const report = await this.evolutionEngine.stop();
    const best = this.evolutionEngine.getBestBrainChromosome();

    let msg =
`╔══════════════════════════════════╗
║   🛑 EVOLUTION ENGINE STOPPED    ║
╚══════════════════════════════════╝\n\n`;

    if (report) {
      msg += `📊 *Generation:* ${report.generation}\n`;
      msg += `🏆 *Best Fitness:* ${this.escMd(report.bestFitness.toFixed(4))}\n`;
      msg += `📈 *Avg Fitness:* ${this.escMd(report.avgFitness.toFixed(4))}\n\n`;
      msg += `━━━━━ Top 5 Brains ━━━━━\n\n`;

      for (let i = 0; i < Math.min(5, report.brainSummaries.length); i++) {
        const s = report.brainSummaries[i];
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
        const pnlIcon = s.return >= 0 ? "🟢" : "🔴";
        msg += `${medal} ${pnlIcon} Fit: ${this.escMd(s.fitness.toFixed(3))} \\| $${this.escMd(s.return.toFixed(2))} \\| ${s.trades} trades\n`;
      }
    }

    if (best) {
      msg += `\n━━━━ 🏆 Best Brain Config ━━━━\n\n`;
      msg += `🆔 ${this.escMd(best.id.slice(0, 20))}\n`;
      for (const gene of best.chromosome.genes) {
        msg += `  ${this.escMd(gene.name)}: ${this.escMd(String(gene.value))}\n`;
      }
    }

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
    this.evolutionEngine = null;
  }
```

- [ ] **Step 9: Rewrite handleEvoStatus with visual design**

Replace `handleEvoStatus` (lines 685-712):
```typescript
  private async handleEvoStatus(chatId: number) {
    if (!this.evolutionEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "⚠️ Evolution is not running\\. Use /evo\\_start", parse_mode: "MarkdownV2" });
      return;
    }

    const status = this.evolutionEngine.getStatus();

    let msg =
`╔══════════════════════════════════╗
║      🧬 EVOLUTION STATUS         ║
╚══════════════════════════════════╝

🔄 *Running:* ${status.running ? "Yes ✅" : "No ❌"}
📊 *Generation:* ${status.generation}
🧠 *Population:* ${status.populationSize} brains

━━━━━━ Top 5 Brains ━━━━━━\n\n`;

    if (status.topBrains.length > 0) {
      for (let i = 0; i < status.topBrains.length; i++) {
        const b = status.topBrains[i];
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
        msg += `${medal} ${this.escMd(b.id.slice(0, 18))} \\| Fit: ${this.escMd(b.fitness.toFixed(4))} \\| Gen: ${b.generation}\n`;
      }
    } else {
      msg += `  Evaluating\\.\\.\\. waiting for first results\n`;
    }

    if (status.recentReports.length > 0) {
      const latest = status.recentReports[status.recentReports.length - 1];
      msg += `\n━━━ Latest Generation Report ━━━\n\n`;
      msg += `🏆 Best: ${this.escMd(latest.bestFitness.toFixed(4))} \\| Avg: ${this.escMd(latest.avgFitness.toFixed(4))}\n`;
    }

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
  }
```

- [ ] **Step 10: Rewrite /start welcome message**

Replace the /start handler (lines 104-109):
```typescript
      if (messageText === "/start") {
        const msg =
`╔══════════════════════════════════╗
║    🤖 CRYPTO ARBITRAGE BOT v2    ║
╚══════════════════════════════════╝

Welcome\\! I scan 5 exchanges for arbitrage opportunities using multiple strategies\\.

━━━━━━━━ Quick Start ━━━━━━━━

⚙️ /config — Configure exchanges \\& pairs
📊 /paper\\_start — Start paper trading
🧬 /evo\\_start — Start evolution engine
🤖 /ai\\_report — AI market analysis
🌊 /ai\\_regime — Market conditions

━━━━━━━ Alert Modes ━━━━━━━━

📈 /direct\\_alerts — Direct arb alerts
🔺 /triangular\\_alerts — Triangular alerts
📜 /transaction\\_history — Trade log

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        await this.bot.sendMessage({
          chat_id: chatId,
          text: msg,
          parse_mode: "MarkdownV2",
        });
      }
```

- [ ] **Step 11: Rewrite handleAiRegime with visual design**

Replace `handleAiRegime` (lines 732-759):
```typescript
  private async handleAiRegime(chatId: number) {
    marketRegimeDetector.recordSnapshot();

    const analysis = marketRegimeDetector.detectRegime();
    const modifiers = marketRegimeDetector.getParameterModifiers(analysis.regime);

    const regimeEmoji: Record<string, string> = {
      calm: "😌", volatile: "⚡", trending: "📈", choppy: "🌊"
    };

    const regimeIcon = regimeEmoji[analysis.regime] || "📊";

    const msg =
`╔══════════════════════════════════╗
║     ${regimeIcon} MARKET REGIME              ║
╚══════════════════════════════════╝

*Regime:* ${this.escMd(analysis.regime.toUpperCase())}
*Confidence:* ${this.escMd((analysis.confidence * 100).toFixed(0))}%

━━━━━━━ Market Data ━━━━━━━

📉 Volatility: ${this.escMd(analysis.volatility.toFixed(1))}% \\(annualized\\)
📏 Avg Spread: ${this.escMd(analysis.spreadMean.toFixed(4))}%
📐 Spread StdDev: ${this.escMd(analysis.spreadStdDev.toFixed(4))}%

━━━━━━ Recommendation ━━━━━━

💡 ${this.escMd(analysis.recommendation)}

━━━━ Parameter Adjustments ━━━━

  Profit Threshold: x${this.escMd(String(modifiers.profitThresholdMultiplier))}
  Trade Size: x${this.escMd(String(modifiers.tradeSizeMultiplier))}
  Scan Speed: x${this.escMd(String(modifiers.scanIntervalMultiplier))}`;

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "MarkdownV2" });
  }
```

- [ ] **Step 12: Add helper methods at end of class**

Add before the closing `}` of the class:
```typescript
  /** Escape MarkdownV2 special characters */
  private escMd(text: string): string {
    return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
  }

  /** Capitalize first letter */
  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
```

- [ ] **Step 13: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 14: Commit**

```bash
git add src/telegram/telegram.controller.ts
git commit -m "feat: multi-strategy paper trading + Telegram UI visual redesign"
```

---

### Task 6: Final Build + Push

- [ ] **Step 1: Full build verification**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Final commit and push**

```bash
git push origin main
```
