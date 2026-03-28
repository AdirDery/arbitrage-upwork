import { ExchangeAdapter } from "./exchangeAdapter";
import { mexcService } from "../exchanges";
import { exchangeQuoteSymbol } from "../exchanges/mexc/mexc.types";
import { OrderbookManager } from "../orderBooks/orderbookManager";

export class MexcAdapter extends ExchangeAdapter {
  name = "Mexc";

  async getOrderbook(symbol: string) {
    const wsBook = OrderbookManager.getOrderbook("Mexc", symbol);
    if (wsBook.timestamp > 0 && Date.now() - wsBook.timestamp < 10000) {
      return { bids: wsBook.bids, asks: wsBook.asks };
    }
    return await mexcService.getOrderBooks(symbol);
  }

  async marketBuy(symbol: exchangeQuoteSymbol, size: number) {
    // execute market buy on Mexc
    return await mexcService.marketBuy(symbol,'', String(size));
  }

  async marketSell(symbol: exchangeQuoteSymbol, size: number) {
    // execute market sell on Mexc
    return await mexcService.marketSell(symbol,'', String(size));
  }

  async cancelOrder(orderId:string, symbol:string){
      // return await binanceService.cancelOrder(orderId, symbol);
  }
  
  async getOrderDetails(orderId:string){
      // return await binanceService.orderDetails(orderId);
  }

  async getFees(symbol: string) {
    // return Mexc trading fees
    return { taker: 0.001, maker: 0.00 };
  }

  async getBalance(asset: string): Promise<number> {
    // TODO: fetch from Mexc account balance API
    console.log(`Fetching balance for ${asset} on Bingx`);
    return 1000; // fake balance
  }

  async crossExchangeTransfer(amount: string, address: string, coin: string): Promise<any> {
    return true;
  }

  minOrderSize(symbol: string): number {
    // TODO: fetch exchange filters from Mexc API (stepSize/lotSize)
    return 0.01; // example min size
  }
}
