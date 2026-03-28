import { ExchangeAdapter } from "./exchangeAdapter";
import { bybitService } from "../exchanges";
import { OrderbookManager } from "../orderBooks/orderbookManager";

export class BybitAdapter extends ExchangeAdapter {
  name = "Bybit";

  async getOrderbook(symbol: string) {
    const wsBook = OrderbookManager.getOrderbook("Bybit", symbol);
    if (wsBook.timestamp > 0 && Date.now() - wsBook.timestamp < 10000) {
      return { bids: wsBook.bids, asks: wsBook.asks };
    }
    return await bybitService.getOrderBook(symbol);
  }

  async marketBuy(symbol: string, size: number) {
    // execute market buy on bybit
    return await bybitService.marketBuy(symbol, String(size));
  }

  async marketSell(symbol: string, size: number) {
    // execute market sell on bybit
    return await bybitService.marketSell(symbol, String(size));
  }

  // async cancelOrder(orderId:string, symbol:string){
  //   return await bybitService.cancelOrder(orderId, symbol);
  // }

  async getOrderDetails(orderId:string){
    return await bybitService.orderDetails(orderId);
  }

  async getFees(symbol: string) {
    // return bybit trading fees
    return { taker: 0.001, maker: 0.001 };
  }

  async getBalance(asset: string): Promise<number> {
    // TODO: fetch from bybit account balance API
    console.log(`Fetching balance for ${asset} on Binance`);
    return 1000; // fake balance
  }

  async crossExchangeTransfer(amount: string, address: string, coin: string): Promise<any> {
    return true;
  }

  minOrderSize(symbol: string): number {
    // TODO: fetch exchange filters from bybit API (stepSize/lotSize)
    return 0.01; // example min size
  }
}
