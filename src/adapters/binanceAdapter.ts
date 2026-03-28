import { ExchangeAdapter } from "./exchangeAdapter";
import { binanceService } from "../exchanges";
import { OrderbookManager } from "../orderBooks/orderbookManager";

export class BinanceAdapter extends ExchangeAdapter {

  name = "Binance"

  async getOrderbook(symbol: string) {
    // Use in-memory WebSocket orderbook if available, fallback to REST
    const wsBook = OrderbookManager.getOrderbook("Binance", symbol);
    if (wsBook.timestamp > 0 && Date.now() - wsBook.timestamp < 10000) {
      return { bids: wsBook.bids, asks: wsBook.asks };
    }
    return await binanceService.getOrderBook(symbol);
  }

  async marketBuy(symbol: string, size: number) {
    // execute market buy on Binance
    return await binanceService.marketBuy(symbol, size);
  }

  async marketSell(symbol: string, size: number) {
    // execute market sell on Binance
    return await binanceService.marketSell(symbol, size);
  }

  async cancelOrder(orderId:string, symbol:string){
     return await Promise.resolve({success:true});
  }
  
  async getOrderDetails(orderId:string){
     return await Promise.resolve({success:true});
  }

  async getFees(symbol: string) {
    // return Binance trading fees
    return { taker: 0.001, maker: 0.001 }; // it is on discount 0.00075
  }

  async getBalance(asset: string): Promise<number> {
    // TODO: fetch from Binance account balance API
    console.log(`Fetching balance for ${asset} on Binance`);
    return 1000; // fake balance
  }

  async crossExchangeTransfer(amount: string, address: string, coin: string): Promise<any> {
    return true;
  }

  minOrderSize(symbol: string): number {
    // TODO: fetch exchange filters from Binance API (stepSize/lotSize)
    return 0.01; // example min size
  }
}
