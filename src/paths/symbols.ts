import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import { BybitAdapter, MexcAdapter, BinanceAdapter, BingXAdapter, OkxAdapter } from "../adapters";
import { UserPreferences } from "../config/config.model";

export const exchangeSymbols = { // contains all the trade symbols supported on following exchanges
  Binance: ["BTCUSDT", "ETHUSDT", "ETHBTC", "SOLUSDT", "SOLBTC", "SOLETH"],
  Bingx: ["BTCUSDT", "ETHUSDT", "ETHBTC","SOLUSDT"],
  Mexc: ["BTCUSDT", "ETHUSDT", "ETHBTC", "SOLUSDT", "SOLBTC"],
  Bybit: ["BTCUSDT", "ETHUSDT","ETHBTC", "SOLBTC","SOLUSDT"],
  Okx: ["BTCUSDT", "ETHBTC","ETHUSDT", "SOLBTC", "SOLETH", "SOLUSDT"],
};


//export const symbolsOnEveryExchange = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ETHBTC'];
export const getSymbolsOnEveryExchange = ()=>{
  const selectedSymbols = UserPreferences.findOne();
  return selectedSymbols;
}



export const exchanges:ExchangeAdapter[] = [
  new BingXAdapter(),
  new BinanceAdapter(),
  new MexcAdapter(),
  new BybitAdapter(),
  new OkxAdapter(),
]



export const allExchanges = {
  Binance: new BinanceAdapter(),
  Bingx: new BingXAdapter(),
  Mexc: new MexcAdapter(),
  Bybit: new BybitAdapter(),
  Okx: new OkxAdapter(),
};

export type ExchangeName = keyof typeof allExchanges;
