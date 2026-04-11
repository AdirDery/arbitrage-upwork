# Crypto Arbitrage Bot v2

Multi-exchange crypto arbitrage system with 5 trading strategies, genetic algorithm optimization, AI-powered market analysis, and paper trading — all controlled via Telegram.

## Supported Exchanges

| Exchange | Spot | Futures | WebSocket Orderbooks |
|----------|------|---------|----------------------|
| Binance  | Yes  | —       | Yes                  |
| Bybit    | Yes  | Yes     | Yes                  |
| OKX      | Yes  | —       | Yes                  |
| BingX    | Yes  | —       | Yes                  |
| MEXC     | Yes  | —       | Yes                  |

## Trading Strategies

All strategies implement the `IStrategy` interface (`scan → evaluate → execute` lifecycle).

### 1. Direct Arbitrage
Buy on Exchange A, sell on Exchange B. Simplest form — exploits price discrepancies for the same trading pair across exchanges.

### 2. Triangular Arbitrage
Three-leg cross-exchange path: USDT → Token X → Token Y → USDT. Profits from pricing inefficiencies across multiple pairs and exchanges.

### 3. Altcoin Arbitrage
Targets 50+ low-cap USDT pairs where spreads are wider (1–5%) due to lower liquidity and less bot competition.

### 4. Funding Rate Arbitrage
Delta-neutral strategy: long spot + short perpetual futures. Collects funding payments while remaining market-neutral. Uses Bybit futures.

### 5. Statistical Arbitrage
Mean-reversion pairs trading on correlated assets. Opens positions when z-score divergence exceeds threshold, closes on convergence.

## Architecture

```
src/
├── adapters/              # Normalized exchange interface (ExchangeAdapter)
│   └── futures/           # Perpetual futures adapters (IFuturesAdapter)
├── ai/                    # Claude API analysis + ML scoring
│   ├── ClaudeAnalysis     #   Daily AI market reports
│   ├── OpportunityScorer  #   Logistic regression profitability prediction
│   ├── MarketRegimeDetector #  Calm / volatile / trending / choppy classification
│   └── CorrelationTracker #   Pairs correlation + z-score signals
├── arbitrage/             # Legacy direct + triangular scanners
├── config/                # MongoDB config + user preferences
├── core/                  # App bootstrap, database, logger (Winston)
├── evolution/             # Genetic algorithm optimization
│   ├── Chromosome         #   Gene encoding for strategy parameters
│   ├── Brain              #   Chromosome + strategy + paper engine
│   ├── Population         #   10-20 concurrent brains, elite preservation
│   ├── EvolutionEngine    #   Full evolution loop with persistence
│   ├── Fitness            #   Sharpe ratio, profit factor, max drawdown
│   └── GeneticOperators   #   Tournament selection, crossover, mutation
├── exchanges/             # Raw API wrappers (Binance, Bybit, OKX, BingX, MEXC)
├── execution/             # ExecutionEngine — sequential leg execution + rollback
├── orderBooks/            # OrderbookManager — WebSocket real-time orderbooks
├── paper/                 # Paper trading engine
│   ├── PaperExchangeAdapter # Wraps real adapters with simulated execution
│   ├── PaperLedger        #   Virtual balance tracking (MongoDB)
│   └── OrderSimulator     #   Realistic fills against live orderbooks
├── strategy/              # IStrategy interface + StrategyRegistry
│   └── implementations/   #   All 5 strategy implementations
├── telegram/              # Telegram bot UI (commands, alerts, handlers)
├── transactions/          # Transaction model (mode: 'live' | 'paper')
└── main.ts                # Entry point
```

## Key Systems

**WebSocket Orderbooks** — The `OrderbookManager` maintains real-time orderbooks for all 5 exchanges via WebSocket with auto-reconnect and keepalive. In-memory reads (0ms latency) with REST fallback if WebSocket data goes stale.

**Paper Trading** — Full simulation engine using real market data with virtual execution. Paper mode wraps real exchange adapters so you test strategies against live orderbooks without risking capital.

**Genetic Evolution** — Runs 10-20 "brains" in parallel, each with different strategy parameters. A genetic algorithm evolves the population over generations using tournament selection, crossover, and mutation. Fitness is measured by Sharpe ratio, profit factor, and max drawdown.

**AI Analysis** — Claude API generates daily market reports, opportunity analysis, and parameter suggestions. A market regime detector classifies conditions (calm/volatile/trending/choppy) and adjusts strategy parameters accordingly.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot |
| `/config` | View/edit configuration |
| `/direct_alerts` | Toggle direct arbitrage alerts |
| `/triangular_alerts` | Toggle triangular arbitrage alerts |
| `/transaction_history` | View trade history |
| `/paper_start` | Start paper trading |
| `/paper_stop` | Stop paper trading |
| `/paper_status` | View paper trading P&L |
| `/paper_reset` | Reset paper balances |
| `/evo_start` | Start evolution engine |
| `/evo_stop` | Stop evolution |
| `/evo_status` | View brain leaderboard |
| `/ai_report` | Generate AI market report |
| `/ai_regime` | View current market regime |

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB
- API keys for at least 2 exchanges
- Telegram bot token (from [@BotFather](https://t.me/BotFather))

### Setup

```bash
# Clone
git clone https://github.com/AdirDery/arbitrage-upwork.git
cd arbitrage-upwork

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and settings

# Build
npm run build

# Run
npm start
```

### Development

```bash
npm run dev    # Start with nodemon (auto-reload)
npm run lint   # Run ESLint
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGO_URI` | MongoDB connection string |
| `PORT` | Server port (default: 8080) |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Binance credentials |
| `BYBIT_API_KEY` / `BYBIT_SECRET` | Bybit credentials |
| `OKX_API_KEY` / `OKX_SECRET` / `OKX_PASSPHRASE` | OKX credentials |
| `BINGX_API_KEY` / `BINGX_SECRET` | BingX credentials |
| `MEXC_API_KEY` / `MEXC_SECRET` | MEXC credentials |
| `BOT_TOKEN` | Telegram bot token |
| `SLIPPAGE_PERCENT` | Max slippage tolerance |
| `DIRECT_ARB_SIZE` | Trade size for direct arbitrage |
| `TRIANGULAR_ARB_SIZE` | Trade size for triangular arbitrage (USDT) |
| `PROFIT_THRESHOLD` | Minimum profit % to trigger trade |

## Tech Stack

- **Runtime:** Node.js + TypeScript (ES2020)
- **Framework:** Express
- **Database:** MongoDB (Mongoose)
- **Real-time:** WebSocket (ws)
- **Exchanges:** Binance SDK, bybit-api, okx-api, mexc-api-sdk
- **AI:** Anthropic Claude API
- **ML:** simple-statistics (regression, z-scores)
- **Bot UI:** Telegram Bot API
- **Logging:** Winston + daily rotate

## Recommended Workflow

1. **Configure** — Set up API keys and connect via Telegram
2. **Paper trade** — Run `/paper_start` to test strategies with virtual capital
3. **Evolve** — Run `/evo_start` to let the genetic algorithm find optimal parameters
4. **Analyze** — Use `/ai_report` and `/ai_regime` for market context
5. **Go live** — Graduate the best-performing brain to live trading
