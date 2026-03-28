import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import { PaperLedger } from "./PaperLedger";
import { OrderSimulator, SimulatedFill } from "./OrderSimulator";
import { order } from "../transactions/transaction.type";
import logger from "../core/logger.service";

const QUOTE_CURRENCIES = ["USDT", "USDC", "BTC", "ETH", "SOL"];

/**
 * Wraps a real ExchangeAdapter for paper trading.
 * - getOrderbook() delegates to real adapter (live market data)
 * - marketBuy()/marketSell() simulate fills against live orderbook, update PaperLedger
 * - getBalance() reads from PaperLedger
 */
export class PaperExchangeAdapter implements ExchangeAdapter {
  readonly name: string;

  constructor(
    private realAdapter: ExchangeAdapter,
    private ledger: PaperLedger,
    private simulator: OrderSimulator
  ) {
    this.name = realAdapter.name;
  }

  /** Delegate to real adapter — we need live market data for paper trading */
  async getOrderbook(symbol: string) {
    return this.realAdapter.getOrderbook(symbol);
  }

  /** Simulate a market buy against the live orderbook */
  async marketBuy(symbol: string, size: number): Promise<order> {
    const { base, quote } = this.parseSymbol(symbol);
    const book = await this.realAdapter.getOrderbook(symbol);

    if (book.asks.length === 0) {
      return { status: "FAILED", msg: "No asks in orderbook" };
    }

    const fill: SimulatedFill = this.simulator.simulateBuy(book.asks, size);

    if (!fill.complete) {
      return { status: "FAILED", msg: "Insufficient orderbook liquidity" };
    }

    // Check if we have enough quote currency
    const totalQuoteNeeded = fill.totalCost + fill.fee;
    if (!this.ledger.debit(this.name, quote, totalQuoteNeeded)) {
      return { status: "FAILED", msg: `Insufficient ${quote} balance on ${this.name}` };
    }

    // Credit the base currency
    this.ledger.credit(this.name, base, fill.filledSize);

    const orderId = `paper_buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      `[PaperTrade] BUY ${fill.filledSize} ${base} @ ${fill.avgPrice.toFixed(4)} on ${this.name} | Cost: ${totalQuoteNeeded.toFixed(4)} ${quote}`
    );

    return {
      status: "SUCCESS",
      orderId,
      amount: String(fill.filledSize),
      price: String(fill.totalCost),
      time: Date.now(),
      msg: `Paper trade: bought ${fill.filledSize} ${base}`,
    };
  }

  /** Simulate a market sell against the live orderbook */
  async marketSell(symbol: string, size: number): Promise<order> {
    const { base, quote } = this.parseSymbol(symbol);
    const book = await this.realAdapter.getOrderbook(symbol);

    if (book.bids.length === 0) {
      return { status: "FAILED", msg: "No bids in orderbook" };
    }

    const fill: SimulatedFill = this.simulator.simulateSell(book.bids, size);

    if (!fill.complete) {
      return { status: "FAILED", msg: "Insufficient orderbook liquidity" };
    }

    // Check if we have enough base currency
    if (!this.ledger.debit(this.name, base, size)) {
      return { status: "FAILED", msg: `Insufficient ${base} balance on ${this.name}` };
    }

    // Credit the quote currency (minus fee)
    const quoteReceived = fill.totalCost - fill.fee;
    this.ledger.credit(this.name, quote, quoteReceived);

    const orderId = `paper_sell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      `[PaperTrade] SELL ${size} ${base} @ ${fill.avgPrice.toFixed(4)} on ${this.name} | Received: ${quoteReceived.toFixed(4)} ${quote}`
    );

    return {
      status: "SUCCESS",
      orderId,
      amount: String(size),
      price: String(fill.totalCost),
      time: Date.now(),
      msg: `Paper trade: sold ${size} ${base}`,
    };
  }

  async getFees(symbol?: string): Promise<{ taker: number; maker: number }> {
    return this.realAdapter.getFees(symbol);
  }

  async getBalance(asset: string): Promise<number> {
    return this.ledger.getBalance(this.name, asset);
  }

  minOrderSize(symbol: string): number {
    return this.realAdapter.minOrderSize(symbol);
  }

  async getOrderDetails(orderId: string, symbol?: string): Promise<any> {
    // Paper trades don't have real order details
    return { orderId, status: "FILLED", note: "paper trade" };
  }

  /** Parse a symbol like "BTCUSDT" into { base: "BTC", quote: "USDT" } */
  private parseSymbol(symbol: string): { base: string; quote: string } {
    for (const quote of QUOTE_CURRENCIES) {
      if (symbol.endsWith(quote) && symbol.length > quote.length) {
        return { base: symbol.slice(0, symbol.length - quote.length), quote };
      }
    }
    // Fallback
    return { base: symbol.slice(0, 3), quote: symbol.slice(3) };
  }
}
