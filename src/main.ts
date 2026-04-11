import express, { response } from "express";
import * as dotenv from "dotenv";
dotenv.config();
import { LoggerService } from "./core/logger.service";
import { DatabaseService } from "./core/database.service";
import { ErrorHandler } from "./utils/error-handler.util";
import { TelegramBot } from "typescript-telegram-bot-api";
import { TelegramController } from "./telegram/telegram.controller";
import { OrderbookManager } from "./orderBooks/orderbookManager";
import { exchangeSymbols } from "./paths/symbols";
import { advisorBrain } from "./ai/AdvisorBrain";
import path from "path";

const {BOT_TOKEN}= process.env;

const app = express();
const logger = new LoggerService();

// Connect to database
new DatabaseService();

app.use(express.json());
// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// OrderbookManager status endpoint
app.get("/orderbooks/status", (req, res) => {
  res.json(OrderbookManager.getStatus());
});

// Serve Mini App static files
app.use("/app", express.static(path.join(__dirname, "../src/public")));

// Dashboard API for Mini App
app.get("/api/dashboard", async (req, res) => {
  try {
    const trades = await advisorBrain.analyzeTradeHistory(24);
    const market = advisorBrain.getMarketState();
    const evo = await advisorBrain.getEvolutionInsights();
    const recommendations = await advisorBrain.generateRecommendations(24);

    res.json({
      pnl: trades.pnl,
      totalTrades: trades.totalTrades,
      winRate: trades.winRate,
      bestStrategy: trades.bestStrategy,
      bestExchangePair: trades.bestExchangePair,
      worstExchangePair: trades.worstExchangePair,
      strategyBreakdown: trades.strategyBreakdown,
      regime: market.regime,
      volatility: market.volatility,
      spreadMean: market.spreadMean,
      correlations: market.correlations,
      evoGeneration: evo.totalGenerations,
      evoFitness: evo.bestFitness,
      evoStrategy: evo.bestStrategy,
      evoImproving: evo.improving,
      recommendations: recommendations.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: "Dashboard data error" });
  }
});

app.use(ErrorHandler.handleError);

// Handle uncaught exceptions and unhandled promise rejections
ErrorHandler.handleUncaughtExceptions();
ErrorHandler.handleUnhandledRejections();

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {

  // Start WebSocket orderbook streams for all exchanges
  // Each exchange gets its own WebSocket connection subscribing to all configured symbols
  const allSymbols = new Set<string>();
  for (const symbols of Object.values(exchangeSymbols)) {
    symbols.forEach(s => allSymbols.add(s));
  }
  const symbolsByExchange: Record<string, string[]> = {};
  for (const [exchange, symbols] of Object.entries(exchangeSymbols)) {
    symbolsByExchange[exchange] = symbols;
  }
  await OrderbookManager.start(symbolsByExchange);
  console.log("📊 OrderbookManager WebSocket streams started");

  //Telegram Initialization
  const bot = new TelegramBot({
    botToken: BOT_TOKEN || "",
  });
  bot.startPolling();
  new TelegramController(bot);

  console.log("🤖 Telegram bot is running...");

  logger.log(`Server is running on port ${PORT}`);
});
