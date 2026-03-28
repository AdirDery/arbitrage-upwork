export type exchangeQuoteSymbol = "SOLUSDT" | "ETHUSDT" | "BTCUSDT";

export interface CrossExchangeTransferParams {
  coin: string;
  chain: string;
  address: string;
  amount: string;
  timestamp: number;
}


