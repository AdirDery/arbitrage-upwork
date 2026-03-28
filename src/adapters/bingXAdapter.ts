import { ExchangeAdapter } from "./exchangeAdapter";
import { bingxService } from "../exchanges";
import { OrderbookManager } from "../orderBooks/orderbookManager";

export class BingXAdapter extends ExchangeAdapter {
  name = "Bingx";

  async getOrderbook(symbol: string) {
    const wsBook = OrderbookManager.getOrderbook("Bingx", symbol);
    if (wsBook.timestamp > 0 && Date.now() - wsBook.timestamp < 10000) {
      return { bids: wsBook.bids, asks: wsBook.asks };
    }
    return await bingxService.getOrderbook(symbol);
  }

  async marketBuy(symbol: string, size: number) {
    // execute market buy on Bingx
    return await bingxService.marketBuy(symbol, size);
  }

  async marketSell(symbol: string, size: number) {
    // execute market sell on Bingx
    return await bingxService.marketSell(symbol, size);
  }

    async cancelOrder(orderId:string, symbol:string){
      // return await binanceService.cancelOrder(orderId, symbol);
  }
  
  async getOrderDetails(orderId:string){
      // return await binanceService.orderDetails(orderId);
  }

  async getFees(symbol: string) {
    // return Bingx trading fees
    return { taker: 0.001, maker: 0.001 }; //maker: contributing liquidity to the orderbooks, taker: extracting liquidity to the orderbooks
  }

  async getBalance(asset: string): Promise<number> {
    // TODO: fetch from Bingx account balance API
    console.log(`Fetching balance for ${asset} on Bingx`);
    return 1000; // fake balance
  }

    async crossExchangeTransfer(amount: string, address: string, coin: string): Promise<any> {
    return true;
  }

  minOrderSize(symbol: string): number {
    // TODO: fetch exchange filters from Bingx API (stepSize/lotSize)
    return 0.01; // example min size
  }
}
