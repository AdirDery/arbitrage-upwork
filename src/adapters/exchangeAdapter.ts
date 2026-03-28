export abstract class ExchangeAdapter {
  abstract getOrderbook(symbol: string): Promise<{ bids: [number, number][]; asks: [number, number][] }>;
  abstract marketBuy(symbol: string, size: number): Promise<any>;
  abstract marketSell(symbol: string, size: number): Promise<any>;
  abstract getFees(amount: string): Promise<{ taker: number; maker: number }>;
  abstract crossExchangeTransfer(amount:string, address:string, coin:string):Promise<any>;
  abstract getOrderDetails(orderId:string):Promise<any>;
  //abstract cancelOrder(orderId:string, symbol:string):Promise<any>;
}
