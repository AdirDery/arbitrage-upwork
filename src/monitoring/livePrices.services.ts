import { binanceService } from "../exchanges";
import { mexcService } from "../exchanges";
import { bingxService } from "../exchanges";
import { bybitService } from "../exchanges";
import { OKXService } from "../exchanges";
import { exchangeQuoteSymbol } from "../exchanges/binance/binance.types";
import { bingXQuoteSymbol } from "../exchanges/bingx/bingx.types";
export class FetchLivePrices {
  constructor() {}

  async BinancePrices() {
    console.log(
      "\n========================= Binance Exchange Prices =========================\n"
    );
    const symbols: exchangeQuoteSymbol[] = ["SOLUSDT", "ETHUSDT", "BTCUSDT"];

    for (const symbol of symbols) {
      try {
        const response = await binanceService.exchangeQuote(symbol);
        console.log(
          `${response.symbol.padEnd(8)} → $${parseFloat(
            response.price
          ).toLocaleString()}`
        );
      } catch (err) {
        console.error(`❌ Failed to fetch ${symbol}:`, err);
      }
    }

    console.log(
      "\n==========================================================================\n"
    );
  }

  async BybitPrices() {
    bybitService.exchangeQuote("SOLUSDT").then((response) => {
      console.log(
        response.result.list[0].symbol,
        response.result.list[0].lastPrice
      );
    });

    console.log(
      "\n========================= Bybit Exchange Prices =========================\n"
    );
    const symbols: exchangeQuoteSymbol[] = ["SOLUSDT", "ETHUSDT", "BTCUSDT"];

    for (const symbol of symbols) {
      try {
        const response = await bybitService.exchangeQuote(symbol);
        console.log(
          `${response.result.list[0].symbol.padEnd(8)} → $${parseFloat(
            response.result.list[0].usdIndexPrice
          ).toLocaleString()}`
        );
      } catch (err) {
        console.error(`❌ Failed to fetch ${symbol}:`, err);
      }
    }

    console.log(
      "\n==========================================================================\n"
    );
  }

  async MexcPrices() {
    mexcService.exchangeQuote("SOLUSDT").then((response) => {
      console.log(
        response.result.list[0].symbol,
        response.result.list[0].lastPrice
      );
    });

    console.log(
      "\n========================= Mexc Exchange Prices =========================\n"
    );
    const symbols: exchangeQuoteSymbol[] = ["SOLUSDT", "ETHUSDT", "BTCUSDT"];

    for (const symbol of symbols) {
      try {
        const response = await mexcService.exchangeQuote(symbol);
        console.log(
          `${response.symbol.padEnd(8)} → $${parseFloat(
            response.price
          ).toLocaleString()}`
        );
      } catch (err) {
        console.error(`❌ Failed to fetch ${symbol}:`, err);
      }
    }

    console.log(
      "\n==========================================================================\n"
    );
  }

  async BingxPrices() {
    console.log(
      "\n========================= Bingx Exchange Prices =========================\n"
    );
    const symbols: bingXQuoteSymbol[] = ["SOL-USDT", "ETH-USDT", "BTC-USDT"];

    for (const symbol of symbols) {
      try {
        const response = await bingxService.exchangeQuote(symbol);
        console.log(
          `${symbol} → $${parseFloat(response[0].price).toLocaleString()}`
        );
      } catch (err) {
        console.error(`❌ Failed to fetch ${symbol}:`, err);
      }
    }

    console.log(
      "\n==========================================================================\n"
    );
  }

  async getPricesForAllCexs() {
    await this.BinancePrices();
    await this.BybitPrices();
    await this.MexcPrices();
    await this.BingxPrices();
  }

}
