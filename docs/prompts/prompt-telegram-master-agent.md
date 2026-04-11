# Prompt — Telegram Master Agent (Mini App + Bot UI/UX + Developer)

## Context

The Crypto Arbitrage Bot v2 uses Telegram as its primary UI via the `typescript-telegram-bot-api` library (v0.10.0). The current Telegram experience is functional but basic — text commands, inline keyboards, and MarkdownV2 formatted messages. There is no Telegram Mini App (Web App), no rich interactive dashboards, no charts, and no persistent menu structure.

**What exists:**
- `src/telegram/telegram.controller.ts` — Main controller with 15+ commands, callback_query handlers, MarkdownV2 card-style formatting
- `src/telegram/config.service.ts` — Config flow with inline keyboards for exchange/currency selection
- `src/telegram/directArbitrageAlerts.service.ts` — Alert UI with start/stop inline buttons
- `src/telegram/triangularArbitrageAlerts.service.ts` — Similar alert UI
- `src/telegram/telegram.service.ts` — Price quote fetching
- `src/main.ts` — Express server on port 8080 with health + orderbook status endpoints
- Bot library: `typescript-telegram-bot-api@0.10.0` (supports `web_app` button type)

**Telegram Bot API features NOT yet used:**
- **Telegram Mini Apps (Web Apps)** — HTML/JS apps that open inside Telegram as a web view
- **Menu Button** — Persistent button that opens a Mini App or command list
- **Web App inline buttons** — `{ web_app: { url: "..." } }` in inline keyboards
- **Reply keyboards with web_app** — Persistent bottom keyboards
- **setMenuButton** — Custom menu button for the bot
- **answerWebAppQuery** — For sending results back from Mini App

**What to build:**
1. A Telegram Mini App (HTML dashboard) served by the Express server showing real-time bot status, P&L, strategy performance, and controls
2. A professional bot menu system with organized command categories
3. Enhanced inline keyboard layouts for all existing commands
4. Web App integration buttons in the bot to launch the dashboard

---

## TASK 1: Create the Mini App Dashboard (HTML + JS)

**File:** Create `src/public/index.html`

This is a single-page Telegram Mini App dashboard. It uses the Telegram Web App JS SDK, calls the bot's Express API, and renders real-time data. No framework needed — vanilla HTML/CSS/JS with Telegram's theming.

**Security note:** When rendering dynamic data, use `textContent` for plain text values to prevent XSS. Only use safe DOM creation methods (createElement, textContent assignment) — never concatenate user-controlled strings into HTML. All data comes from our own API, but defense-in-depth is good practice.

Build the HTML file with:
- Telegram Web App JS SDK (`https://telegram.org/js/telegram-web-app.js`)
- CSS variables mapping to Telegram theme colors (`--tg-theme-bg-color`, `--tg-theme-text-color`, etc.)
- Three tabs: Overview (P&L, regime, evolution), Strategies (breakdown + recommendations), Exchanges (connection status)
- Fetch data from `/api/dashboard` endpoint
- Auto-refresh every 30 seconds
- Use `document.createElement()` and `.textContent` for all dynamic content rendering
- Mobile-friendly layout (Telegram Mini Apps are mobile-first)
- Card-based design with metric rows, strategy chips grid, exchange connection dots
- A floating refresh button at the bottom
- Color classes: `.positive` (green), `.negative` (red), `.neutral` (default text)

The dashboard should show:
- Big P&L number (green/red colored)
- Total trades, win rate, best strategy
- Market regime with emoji, volatility, avg spread
- Evolution generation, best fitness, best strategy
- Strategy breakdown grid (2 columns, each showing name + P&L + trades + win rate)
- Recommendations list (numbered)
- Exchange connection status with colored dots (green=connected)

---

## TASK 2: Create the Dashboard API Endpoint

**File:** Modify `src/main.ts`

Add this import at the top of main.ts, after existing imports:
```typescript
import { advisorBrain } from "./ai/AdvisorBrain";
import path from "path";
```

Add these lines after the existing `/orderbooks/status` endpoint (after line 29):

```typescript
// Serve Mini App static files
app.use("/app", express.static(path.join(__dirname, "../src/public")));

// Dashboard API — provides all data for the Mini App
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
```

---

## TASK 3: Add Mini App Button + Enhanced Menu to Telegram Bot

**File:** Modify `src/telegram/telegram.controller.ts`

### Step 1: Add the /dashboard command to setCommands()

Add to the commands array:
```typescript
      { command: 'dashboard', description: 'Open trading dashboard' },
```

### Step 2: Add command routing

Add in registerHandlers after the advisor commands:
```typescript
      // ─── Dashboard Command ───
      if(messageText === "/dashboard"){
        await this.handleDashboard(chatId);
      }
```

### Step 3: Add the dashboard handler method

Add before the `escMd()` helper:
```typescript
  // ─── Dashboard Handler ─────────────────────────────────────

  private async handleDashboard(chatId: number) {
    const port = process.env.PORT || 8080;
    const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;
    const webAppUrl = `${serverUrl}/app/index.html`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📊 Open Dashboard", web_app: { url: webAppUrl } }],
        [
          { text: "📈 Paper Status", callback_data: "quick_paper_status" },
          { text: "🧬 Evo Status", callback_data: "quick_evo_status" },
        ],
        [
          { text: "🧠 Advisor Report", callback_data: "quick_advisor_report" },
          { text: "🌊 Market Regime", callback_data: "quick_regime" },
        ],
      ],
    };

    const msg =
`╔══════════════════════════════════╗
║      📊 TRADING DASHBOARD        ║
╚══════════════════════════════════╝

Open the full interactive dashboard or use quick actions below\\.`;

    await this.bot.sendMessage({
      chat_id: chatId,
      text: msg,
      reply_markup: keyboard,
      parse_mode: "MarkdownV2",
    });
  }
```

### Step 4: Add quick action callback handlers

Add a new callback_query listener in registerHandlers:

```typescript
    this.bot.on("callback_query", async (query) => {
      const chatId = query?.from?.id;
      const data = query.data;
      if (!data) return;

      try {
        if (data === "quick_paper_status") {
          await this.handlePaperStatus(chatId);
        } else if (data === "quick_evo_status") {
          await this.handleEvoStatus(chatId);
        } else if (data === "quick_advisor_report") {
          await this.handleAdvisorReport(chatId);
        } else if (data === "quick_regime") {
          await this.handleAiRegime(chatId);
        } else if (data === "quick_paper_start") {
          await this.handlePaperStart(chatId);
        } else if (data === "quick_advisor_start") {
          await this.handleAdvisorStart(chatId);
        }
      } catch (err) {
        console.error("[Telegram Controller] Quick action error:", err);
      }
    });
```

### Step 5: Update /start welcome message

Replace the existing /start handler to include the dashboard button and quick-start actions. Add `web_app` button + inline keyboard with Paper Trade and AI Advisor quick-start buttons. Include `/dashboard` and `/advisor_start` in the command list.

---

## TASK 4: Add SERVER_URL to Environment

**File:** Add to `.env.example` (and your actual `.env`)

```
SERVER_URL=https://your-server-ip-or-domain:8080
```

**Important:** For the Telegram Mini App to work, the URL must be HTTPS. Options:
- Use a domain with SSL certificate (Let's Encrypt / Cloudflare)
- Use ngrok for testing: `ngrok http 8080` — use the https URL
- Or use Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:8080`

Without HTTPS, the web_app button will not work in Telegram (Telegram requires HTTPS for Mini Apps).

---

## Execution Order

1. **TASK 1** — Create `src/public/index.html` (no dependencies)
2. **TASK 2** — Modify `src/main.ts` (serves the HTML + API endpoint)
3. **TASK 3** — Modify `src/telegram/telegram.controller.ts` (adds dashboard command + buttons)
4. **TASK 4** — Configure SERVER_URL in .env

## Rules

- **Protocol 4** (Telegram Command) + **Protocol 8** (Config Change)
- Mini App uses Telegram Web App JS SDK — auto-adapts to user's Telegram theme (dark/light)
- All data from `/api/dashboard` endpoint — zero additional API costs (uses existing AdvisorBrain)
- **XSS prevention:** Use `textContent` and `createElement` for dynamic content — never set raw HTML from API data
- HTTPS required for Mini Apps — must configure SSL or use tunnel
- All Telegram messages continue using MarkdownV2 with escMd()
- Express static file serving for the dashboard HTML
- Auto-refresh every 30 seconds in the Mini App
- `web_app` button type requires `typescript-telegram-bot-api@0.10.0+` (already installed)

## Verification

```bash
# Build
npm run build

# Start
npm start

# Test API endpoint
curl http://localhost:8080/api/dashboard

# Test Mini App page
# Open http://localhost:8080/app/index.html in a browser

# Test in Telegram:
# /start → Should show "Open Dashboard" button
# /dashboard → Should show dashboard card with web_app button + quick actions
# Click "Open Dashboard" → Should open Mini App inside Telegram (requires HTTPS)

# If testing without HTTPS:
# Install ngrok: npm install -g ngrok
# Run: ngrok http 8080
# Copy the https URL to SERVER_URL in .env
# Restart the bot
```

## HTTPS Setup for Production

For the Mini App to work in Telegram, you need HTTPS. Cheapest options:

**Option A: Cloudflare Tunnel (free, recommended)**
```bash
cloudflared tunnel --url http://localhost:8080
# Copy the https URL to SERVER_URL in .env
```

**Option B: ngrok (free for testing)**
```bash
npm install -g ngrok
ngrok http 8080
# Copy the https URL to SERVER_URL in .env
```

**Option C: Let's Encrypt (free, needs domain)**
```bash
# Requires a domain name pointing to your server
# Use certbot to get free SSL certificate
```
