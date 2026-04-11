# Crypto Arbitrage Bot v2

Multi-exchange crypto arbitrage system with 5 trading strategies, genetic algorithm optimization, autonomous AI advisor, risk management, Telegram Mini App dashboard, and paper trading — all controlled via Telegram.

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
├── ai/                    # AI advisor + market analysis (zero cost)
│   ├── TradingAdvisor     #   Autonomous monitor — hourly/6h reports to Telegram
│   ├── AdvisorBrain       #   Persistent brain — learns from trade history
│   ├── ClaudeAnalysis     #   Optional: Claude API reports (costs money)
│   ├── OpportunityScorer  #   Logistic regression profitability prediction
│   ├── MarketRegimeDetector #  Calm / volatile / trending / choppy classification
│   └── CorrelationTracker #   Pairs correlation + z-score signals
├── arbitrage/             # Legacy direct + triangular scanners
├── config/                # MongoDB config + user preferences
├── core/                  # App bootstrap, database, logger (Winston)
├── evolution/             # Genetic algorithm optimization
│   ├── Chromosome         #   Gene encoding (5 strategy types)
│   ├── Brain              #   Chromosome + strategy + paper engine
│   ├── Population         #   12 mixed-strategy brains, elite preservation
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
├── public/                # Telegram Mini App dashboard (HTML/CSS/JS)
├── risk/                  # Risk management system
│   ├── RiskManager        #   Trade guardian — pre/post trade checks
│   ├── RiskBrain          #   Tracks P&L, drawdown, streaks, circuit breakers
│   └── risk.model         #   MongoDB: RiskConfig, DailyRiskRecord, RiskEvent
├── strategy/              # IStrategy interface + StrategyRegistry
│   └── implementations/   #   All 5 strategy implementations
├── telegram/              # Telegram bot UI (commands, alerts, handlers)
├── transactions/          # Transaction model (mode: 'live' | 'paper')
└── main.ts                # Entry point + dashboard API
```

## Key Systems

**WebSocket Orderbooks** — The `OrderbookManager` maintains real-time orderbooks for all 5 exchanges via WebSocket with auto-reconnect and keepalive. In-memory reads (0ms latency) with REST fallback if WebSocket data goes stale.

**Paper Trading** — Launches all 4 strategies simultaneously (Direct, Altcoin, Triangular, Statistical) with $10K virtual capital per exchange. Real market data, simulated execution.

**Genetic Evolution** — Runs 12 mixed-strategy brains in parallel. Each brain has different strategy parameters encoded in a chromosome. A genetic algorithm evolves the population over 24h evaluation cycles using tournament selection, crossover, and mutation.

**AI Trading Advisor (Zero Cost)** — Autonomous agent that monitors market regime, strategy performance, correlation signals, and evolution progress. Sends hourly snapshots, 6-hour deep analysis reports, and instant alerts to Telegram. All rule-based — no API calls.

**Risk Management** — Every trade passes through the RiskManager before execution. Circuit breakers halt trading on: daily loss > $50, 5 consecutive losses, or oversized trades. Auto-resumes after 1h cooldown. Reports every 4 hours with loss meter, weekly summary, and recommendations.

**Telegram Mini App** — Interactive HTML dashboard that opens inside Telegram. Shows real-time P&L, strategy breakdown, exchange status, and AI recommendations. Served by the Express server at `/app/index.html`.

## Telegram Commands

### Core
| Command | Description |
|---------|-------------|
| `/start` | Initialize bot with quick-start buttons |
| `/config` | Configure exchanges, pairs, and parameters |
| `/dashboard` | Open Mini App dashboard |
| `/transaction_history` | View trade history |

### Paper Trading
| Command | Description |
|---------|-------------|
| `/paper_start` | Start paper trading (all 4 strategies) |
| `/paper_stop` | Stop paper trading + show results |
| `/paper_status` | P&L, strategy breakdown, win rate bar |
| `/paper_reset` | Reset virtual balances |

### Evolution
| Command | Description |
|---------|-------------|
| `/evo_start` | Start 12 mixed-strategy brains |
| `/evo_stop` | Stop + show top brains with medals |
| `/evo_status` | Leaderboard + generation report |

### AI Advisor
| Command | Description |
|---------|-------------|
| `/advisor_start` | Start autonomous advisor + risk manager |
| `/advisor_stop` | Stop advisor and risk manager |
| `/advisor_report` | Instant deep analysis report |

### Risk Management
| Command | Description |
|---------|-------------|
| `/risk_status` | Risk report with loss meter + weekly summary |
| `/risk_reset` | Resume trading after circuit breaker halt |

### Alerts
| Command | Description |
|---------|-------------|
| `/direct_alerts` | Direct arbitrage opportunity alerts |
| `/triangular_alerts` | Triangular arbitrage alerts |
| `/ai_report` | Claude API market analysis (optional, costs money) |
| `/ai_regime` | Current market regime classification |

## Risk Limits (Default)

| Limit | Value | Purpose |
|-------|-------|---------|
| Max daily loss | $50 | 5% of $1K capital |
| Max consecutive losses | 5 | Stop losing streaks |
| Max trade size | $100 | No single big bet |
| Max portfolio risk/trade | 5% | Position sizing |
| Max daily trades | 100 | Prevent overtrading |
| Cooldown after halt | 60 min | Auto-resume period |

All limits are configurable via MongoDB (`riskconfigs` collection).

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
| `SERVER_URL` | HTTPS URL for Telegram Mini App (use cloudflared or ngrok) |
| `CLAUDE_API_KEY` | Optional: Anthropic API key for `/ai_report` |
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
- **AI:** Rule-based advisor (zero cost) + optional Claude API
- **ML:** simple-statistics (regression, z-scores, correlation)
- **Bot UI:** Telegram Bot API + Telegram Mini App (Web App)
- **Logging:** Winston + daily rotate

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /orderbooks/status` | WebSocket orderbook connection status |
| `GET /api/dashboard` | Full dashboard data (P&L, strategies, regime, evolution) |
| `GET /app/index.html` | Telegram Mini App dashboard |

## Recommended Workflow

1. **Configure** — Set up API keys and connect via Telegram (`/config`)
2. **Start advisor** — Run `/advisor_start` to begin monitoring + risk management
3. **Paper trade** — Run `/paper_start` to test all strategies with virtual capital
4. **Evolve** — Run `/evo_start` to let the genetic algorithm find optimal parameters
5. **Monitor** — Check `/dashboard`, `/risk_status`, `/advisor_report` regularly
6. **Go live** — Graduate the best-performing brain to live trading
