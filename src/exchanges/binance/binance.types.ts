export type exchangeQuoteSymbol = "SOLUSDT" | "ETHUSDT" | "BTCUSDT";
type OrderbookSide = Array<[number, number]>;

export interface Orderbook {
  bids: OrderbookSide;
  asks: OrderbookSide;
}