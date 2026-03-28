import WebSocket from "ws";
import zlib from "zlib";
import logger from "../core/logger.service";

export type OrderbookSnapshot = {
  bids: [number, number][]; // [price, quantity] sorted descending
  asks: [number, number][]; // [price, quantity] sorted ascending
  timestamp: number;
};

type ExchangeConnection = {
  ws: WebSocket | null;
  reconnectTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
  symbols: string[];
};

/**
 * Singleton OrderbookManager — maintains in-memory orderbook snapshots
 * for all subscribed symbols across all exchanges via WebSocket streams.
 *
 * getOrderbook() returns instantly from memory (0ms) instead of REST (~200ms).
 */
class OrderbookManagerClass {
  // exchange -> symbol -> snapshot
  private books: Map<string, Map<string, OrderbookSnapshot>> = new Map();
  private connections: Map<string, ExchangeConnection> = new Map();
  private isRunning = false;

  /** Get an orderbook snapshot from memory. Returns empty if not yet received. */
  getOrderbook(exchange: string, symbol: string): OrderbookSnapshot {
    const exchangeBooks = this.books.get(exchange);
    if (!exchangeBooks) return { bids: [], asks: [], timestamp: 0 };
    return exchangeBooks.get(symbol) || { bids: [], asks: [], timestamp: 0 };
  }

  /** Check if we have a fresh orderbook (less than 10 seconds old) */
  hasFreshOrderbook(exchange: string, symbol: string): boolean {
    const book = this.getOrderbook(exchange, symbol);
    return book.timestamp > 0 && Date.now() - book.timestamp < 10000;
  }

  /** Store an orderbook snapshot */
  private setOrderbook(exchange: string, symbol: string, book: OrderbookSnapshot) {
    if (!this.books.has(exchange)) {
      this.books.set(exchange, new Map());
    }
    this.books.get(exchange)!.set(symbol, book);
  }

  /** Subscribe to orderbook streams for all exchanges and symbols */
  async start(symbolsByExchange: Record<string, string[]>) {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("[OrderbookManager] Starting WebSocket orderbook streams...");

    for (const [exchange, symbols] of Object.entries(symbolsByExchange)) {
      this.connectExchange(exchange, symbols);
    }
  }

  /** Disconnect all WebSocket connections */
  async stop() {
    this.isRunning = false;
    for (const [exchange, conn] of this.connections) {
      if (conn.pingTimer) clearInterval(conn.pingTimer);
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      if (conn.ws) conn.ws.close();
      logger.info(`[OrderbookManager] Disconnected ${exchange}`);
    }
    this.connections.clear();
  }

  /** Get all exchanges and their subscribed symbols */
  getStatus(): Record<string, { symbols: string[]; connected: boolean; bookCount: number }> {
    const status: Record<string, any> = {};
    for (const [exchange, conn] of this.connections) {
      const exchangeBooks = this.books.get(exchange);
      status[exchange] = {
        symbols: conn.symbols,
        connected: conn.ws?.readyState === WebSocket.OPEN,
        bookCount: exchangeBooks?.size || 0,
      };
    }
    return status;
  }

  private connectExchange(exchange: string, symbols: string[]) {
    const lowerExchange = exchange.toLowerCase();
    switch (lowerExchange) {
      case "binance": this.connectBinance(symbols); break;
      case "bybit": this.connectBybit(symbols); break;
      case "okx": this.connectOkx(symbols); break;
      case "bingx": this.connectBingx(symbols); break;
      case "mexc": this.connectMexc(symbols); break;
      default: logger.error(`[OrderbookManager] Unknown exchange: ${exchange}`);
    }
  }

  private scheduleReconnect(exchange: string, symbols: string[], delayMs = 3000) {
    if (!this.isRunning) return;
    const conn = this.connections.get(exchange);
    if (conn?.reconnectTimer) clearTimeout(conn.reconnectTimer);
    const timer = setTimeout(() => {
      logger.info(`[OrderbookManager] Reconnecting ${exchange}...`);
      this.connectExchange(exchange, symbols);
    }, delayMs);
    if (conn) conn.reconnectTimer = timer;
  }

  // ─── BINANCE ───────────────────────────────────────────────
  // Uses combined stream: @depth20@100ms gives full 20-level snapshots every 100ms
  private connectBinance(symbols: string[]) {
    const streams = symbols.map(s => `${s.toLowerCase()}@depth20@100ms`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    const ws = new WebSocket(url);
    const conn: ExchangeConnection = { ws, reconnectTimer: null, pingTimer: null, symbols };
    this.connections.set("Binance", conn);

    ws.on("open", () => {
      logger.info(`[OrderbookManager] Binance WS connected (${symbols.length} symbols)`);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Combined stream format: { stream: "btcusdt@depth20@100ms", data: { bids, asks } }
        if (msg.data && msg.stream) {
          const symbol = msg.stream.split("@")[0].toUpperCase(); // btcusdt -> BTCUSDT
          const bids: [number, number][] = msg.data.bids.map(([p, q]: [string, string]) => [Number(p), Number(q)]);
          const asks: [number, number][] = msg.data.asks.map(([p, q]: [string, string]) => [Number(p), Number(q)]);
          this.setOrderbook("Binance", symbol, { bids, asks, timestamp: Date.now() });
        }
      } catch (err) {
        logger.error("[OrderbookManager] Binance parse error", err);
      }
    });

    ws.on("error", (err) => logger.error("[OrderbookManager] Binance WS error", err));
    ws.on("close", () => {
      logger.info("[OrderbookManager] Binance WS closed");
      this.scheduleReconnect("Binance", symbols);
    });
    // Binance sends ping frames automatically; ws library auto-responds with pong
  }

  // ─── BYBIT ─────────────────────────────────────────────────
  // orderbook.50.{SYMBOL} — sends snapshot first, then deltas.
  // We process both snapshot and delta to keep book fresh.
  private connectBybit(symbols: string[]) {
    const url = "wss://stream.bybit.com/v5/public/spot";
    const ws = new WebSocket(url);
    const conn: ExchangeConnection = { ws, reconnectTimer: null, pingTimer: null, symbols };
    this.connections.set("Bybit", conn);

    ws.on("open", () => {
      logger.info(`[OrderbookManager] Bybit WS connected (${symbols.length} symbols)`);
      const args = symbols.map(s => `orderbook.50.${s}`);
      ws.send(JSON.stringify({ op: "subscribe", args }));

      // Bybit requires ping every 20 seconds
      conn.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: "ping" }));
        }
      }, 20000);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.topic?.startsWith("orderbook.") && msg.data) {
          const symbol = msg.data.s;
          if (msg.type === "snapshot") {
            const bids: [number, number][] = msg.data.b.map(([p, q]: [string, string]) => [Number(p), Number(q)]);
            const asks: [number, number][] = msg.data.a.map(([p, q]: [string, string]) => [Number(p), Number(q)]);
            this.setOrderbook("Bybit", symbol, { bids, asks, timestamp: msg.ts });
          } else if (msg.type === "delta") {
            // Apply delta updates to existing snapshot
            const existing = this.getOrderbook("Bybit", symbol);
            if (existing.timestamp > 0) {
              const bids = this.applyDelta(existing.bids, msg.data.b, "desc");
              const asks = this.applyDelta(existing.asks, msg.data.a, "asc");
              this.setOrderbook("Bybit", symbol, { bids, asks, timestamp: msg.ts });
            }
          }
        }
      } catch (err) {
        logger.error("[OrderbookManager] Bybit parse error", err);
      }
    });

    ws.on("error", (err) => logger.error("[OrderbookManager] Bybit WS error", err));
    ws.on("close", () => {
      if (conn.pingTimer) clearInterval(conn.pingTimer);
      logger.info("[OrderbookManager] Bybit WS closed");
      this.scheduleReconnect("Bybit", symbols);
    });
  }

  // ─── OKX ───────────────────────────────────────────────────
  // books5 channel — 5-level snapshots only, pushed every ~100ms
  private connectOkx(symbols: string[]) {
    const url = "wss://ws.okx.com:8443/ws/v5/public";
    const ws = new WebSocket(url);
    const conn: ExchangeConnection = { ws, reconnectTimer: null, pingTimer: null, symbols };
    this.connections.set("Okx", conn);

    ws.on("open", () => {
      logger.info(`[OrderbookManager] OKX WS connected (${symbols.length} symbols)`);
      // OKX uses hyphenated symbols: BTCUSDT -> BTC-USDT
      const args = symbols.map(s => {
        const formatted = this.formatOkxSymbol(s);
        return { channel: "books5", instId: formatted };
      });
      ws.send(JSON.stringify({ op: "subscribe", args }));

      // OKX: send "ping" text if idle
      conn.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 25000);
    });

    ws.on("message", (raw) => {
      try {
        const text = raw.toString();
        if (text === "pong") return; // keepalive response

        const msg = JSON.parse(text);
        if (msg.arg?.channel === "books5" && msg.data?.[0]) {
          const instId = msg.arg.instId; // e.g., "BTC-USDT"
          const symbol = instId.replace("-", ""); // -> "BTCUSDT"
          const data = msg.data[0];
          const bids: [number, number][] = data.bids.map(([p, q]: string[]) => [Number(p), Number(q)]);
          const asks: [number, number][] = data.asks.map(([p, q]: string[]) => [Number(p), Number(q)]);
          this.setOrderbook("Okx", symbol, { bids, asks, timestamp: Number(data.ts) });
        }
      } catch (err) {
        logger.error("[OrderbookManager] OKX parse error", err);
      }
    });

    ws.on("error", (err) => logger.error("[OrderbookManager] OKX WS error", err));
    ws.on("close", () => {
      if (conn.pingTimer) clearInterval(conn.pingTimer);
      logger.info("[OrderbookManager] OKX WS closed");
      this.scheduleReconnect("Okx", symbols);
    });
  }

  // ─── BINGX ─────────────────────────────────────────────────
  // {SYMBOL}@depth20 — full snapshots, GZIP compressed messages
  private connectBingx(symbols: string[]) {
    const url = "wss://open-api-ws.bingx.com/market";
    const ws = new WebSocket(url);
    const conn: ExchangeConnection = { ws, reconnectTimer: null, pingTimer: null, symbols };
    this.connections.set("Bingx", conn);

    ws.on("open", () => {
      logger.info(`[OrderbookManager] BingX WS connected (${symbols.length} symbols)`);
      for (const s of symbols) {
        const formatted = this.formatBingxSymbol(s); // BTCUSDT -> BTC-USDT
        ws.send(JSON.stringify({
          id: `depth_${s}`,
          reqType: "sub",
          dataType: `${formatted}@depth20`,
        }));
      }
    });

    ws.on("message", (raw) => {
      try {
        // BingX compresses all messages with GZIP
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
        const text = zlib.gunzipSync(buf).toString("utf-8");

        // Handle ping/pong
        if (text === "Ping") {
          ws.send("Pong");
          return;
        }

        const msg = JSON.parse(text);
        if (msg.dataType?.includes("@depth") && msg.data) {
          // dataType: "BTC-USDT@depth20" -> symbol: "BTCUSDT"
          const symbol = msg.dataType.split("@")[0].replace("-", "");
          const bids: [number, number][] = (msg.data.bids || []).map(([p, q]: [string, string]) => [Number(p), Number(q)]);
          const asks: [number, number][] = (msg.data.asks || []).map(([p, q]: [string, string]) => [Number(p), Number(q)]);
          this.setOrderbook("Bingx", symbol, { bids, asks, timestamp: msg.data.ts || Date.now() });
        }
      } catch (err) {
        // Silently skip non-gzip messages (subscription confirmations etc.)
      }
    });

    ws.on("error", (err) => logger.error("[OrderbookManager] BingX WS error", err));
    ws.on("close", () => {
      logger.info("[OrderbookManager] BingX WS closed");
      this.scheduleReconnect("Bingx", symbols);
    });
  }

  // ─── MEXC ──────────────────────────────────────────────────
  // spot@public.limit.depth.v3.api@{SYMBOL}@20 — full 20-level snapshots
  private connectMexc(symbols: string[]) {
    const url = "wss://wbs-api.mexc.com/ws";
    const ws = new WebSocket(url);
    const conn: ExchangeConnection = { ws, reconnectTimer: null, pingTimer: null, symbols };
    this.connections.set("Mexc", conn);

    ws.on("open", () => {
      logger.info(`[OrderbookManager] MEXC WS connected (${symbols.length} symbols)`);
      for (const s of symbols) {
        ws.send(JSON.stringify({
          method: "SUBSCRIPTION",
          params: [`spot@public.limit.depth.v3.api@${s}@20`],
        }));
      }

      // MEXC requires periodic ping
      conn.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: "PING" }));
        }
      }, 20000);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // MEXC depth format: { channel, symbol, publiclimitdepths: { asksList, bidsList } }
        if (msg.channel?.includes("limit.depth") && msg.publiclimitdepths) {
          const symbol = msg.symbol; // e.g., "BTCUSDT"
          const data = msg.publiclimitdepths;
          // MEXC uses {price, quantity} objects, not arrays
          const bids: [number, number][] = (data.bidsList || []).map((b: any) => [Number(b.price), Number(b.quantity)]);
          const asks: [number, number][] = (data.asksList || []).map((a: any) => [Number(a.price), Number(a.quantity)]);
          this.setOrderbook("Mexc", symbol, { bids, asks, timestamp: msg.sendtime || Date.now() });
        }
      } catch (err) {
        // Skip non-JSON messages (PONG responses etc.)
      }
    });

    ws.on("error", (err) => logger.error("[OrderbookManager] MEXC WS error", err));
    ws.on("close", () => {
      if (conn.pingTimer) clearInterval(conn.pingTimer);
      logger.info("[OrderbookManager] MEXC WS closed");
      this.scheduleReconnect("Mexc", symbols);
    });
  }

  // ─── HELPERS ───────────────────────────────────────────────

  /** Apply delta updates to an orderbook side */
  private applyDelta(
    existing: [number, number][],
    deltas: [string, string][] | undefined,
    sort: "asc" | "desc"
  ): [number, number][] {
    if (!deltas || deltas.length === 0) return existing;

    const book = new Map<number, number>(existing.map(([p, q]) => [p, q]));
    for (const [priceStr, qtyStr] of deltas) {
      const price = Number(priceStr);
      const qty = Number(qtyStr);
      if (qty === 0) {
        book.delete(price); // remove level
      } else {
        book.set(price, qty); // update/add level
      }
    }

    const result = Array.from(book.entries()) as [number, number][];
    if (sort === "desc") {
      result.sort((a, b) => b[0] - a[0]); // bids: highest first
    } else {
      result.sort((a, b) => a[0] - b[0]); // asks: lowest first
    }
    return result;
  }

  /** Convert BTCUSDT -> BTC-USDT for OKX */
  private formatOkxSymbol(symbol: string): string {
    const quotes = ["USDT", "USDC", "BTC", "ETH", "SOL"];
    for (const q of quotes) {
      if (symbol.endsWith(q) && symbol.length > q.length) {
        return `${symbol.slice(0, symbol.length - q.length)}-${q}`;
      }
    }
    return `${symbol.slice(0, 3)}-${symbol.slice(3)}`;
  }

  /** Convert BTCUSDT -> BTC-USDT for BingX */
  private formatBingxSymbol(symbol: string): string {
    return this.formatOkxSymbol(symbol); // same format
  }
}

// Singleton export
export const OrderbookManager = new OrderbookManagerClass();
