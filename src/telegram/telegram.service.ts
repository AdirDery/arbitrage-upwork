import { binanceService, bybitService } from "../exchanges";
import { exchangeQuoteSymbol } from "../exchanges/binance/binance.types";

export class TelegramService {
  async fetchBinancePrices() {
    try {
      const symbols: exchangeQuoteSymbol[] = ["SOLUSDT", "ETHUSDT", "BTCUSDT"];
      const response = await Promise.allSettled(
        symbols.map(binanceService.exchangeQuote)
      );
      const quotes = response.map((r, i) =>
        r.status === "fulfilled"
          ? `${r.value.symbol} -> ${r.value.price}`
          : `${symbols[i]} -> N/A`
      );
      return `Binance Price Quotes:\n${quotes.join("\n")}`;
    } catch (error) {
      console.error("Error fetching Binance quote:", error || error);
      return "Failed to fetch Binance price, please try again later.";
    }
  }


  async fetchBybitPrices() {
    try {
      const symbols: exchangeQuoteSymbol[] = ["SOLUSDT", "ETHUSDT", "BTCUSDT"];
      const response = await Promise.allSettled(
        symbols.map(symbol => bybitService.exchangeQuote(symbol))
      );
      const quotes = response.map((r, i) =>
        r.status === "fulfilled"
          ? `${symbols[i]} -> ${JSON.stringify(r.value.result.list[0].lastPrice)}`
          : `${symbols[i]} -> N/A`
      );
      return `Bybit Price Quotes:\n${quotes.join("\n")}`;
    } catch (error) {
      console.error("Error fetching Bybit quote:", error || error);
      return "Failed to fetch Bybit price, please try again later.";
    }
  }
}
