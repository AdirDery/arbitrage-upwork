export type orderbookSide = Array<[number, number]>;

export interface ExchangeOrderbook {
  bids: orderbookSide;
  asks: orderbookSide;
}


export type Orderbook = {
  bids: [number, number][]; // price , quantity
  asks: [number, number][];
};

export type GetOrderbookFn = (symbol:string) => Promise<Orderbook>;

