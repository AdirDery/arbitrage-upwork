import { RestClientV5, CategoryV5 } from "bybit-api";
import WebSocket from "ws";
import { exchangeQuoteSymbol, CrossExchangeTransferParams } from "./bybit.types";
import { order } from "../../transactions/transaction.type";

const { BYBIT_WS_URL } = process.env;

class BYbitService {
  private apiKey: string;
  private secret: string;
  private client: RestClientV5;
  private ws: WebSocket | null = null;

  constructor() {
    this.apiKey = process.env.BYBIT_API_KEY as string;
    this.secret = process.env.BYBIT_SECRET as string;
    this.client = new RestClientV5({
     // testnet: true,
      key: this.apiKey,
      secret: this.secret,
      recv_window: 10000,
    });
  }

  async marketBuy(symbol: string, quantity: string) {
    try {
      const response = await this.client.submitOrder({
        category: "spot",
        symbol,
        side: "Buy",
        orderType: "Market",
        qty: quantity,
        // marketUnit:'quoteCoin'
      });
      let status = '';
      console.log(`bybit market buy: `, response.retExtInfo);
      if(!response.result.orderId){
        status = 'FAILED'
      }else{
        status = 'SUCCESS'
      }

      const result:order ={
        msg:response?.retMsg,
        status:status,
        orderId:response?.result?.orderId,
        orderLinkId:response?.result?.orderLinkId,
        time:response?.time
      }
      return result;
    } catch (error) {
      console.error("Market Buy Error:", error);
      //throw error;
    }
  }

  async marketSell(symbol: string, quantity: string) {
    try {             
      const response = await this.client.submitOrder({
        category: "spot",
        symbol: symbol,
        side: "Sell",
        orderType: "Market",
        qty: quantity,
      });
      let status = '';
      console.log(`bybit market sell: `, response);
      if(!response.result.orderId){
        status = 'FAILED'
      }else{
        status = 'SUCCESS'
      }

       const result:order ={
        msg:response?.retMsg,
        status:status,
        orderId:response?.result?.orderId,
        orderLinkId:response?.result?.orderLinkId,
        time:response?.time
      }

    return result;
    
      } catch (error) {
      console.error("Market Buy Error:", error);
      //throw error;
    }
  }

  async cancelOrder(symbol:string, orderId:string){
    try {
      const response = await this.client.cancelOrder({
        category:'spot',
        symbol:symbol,
        orderId:orderId,
      })
      return response;
    } catch (error) {
      console.log(`Error occured while bybit cancel order: `, error);
    }
  }

  async orderDetails(orderId:string){
    try {
      const response = await this.client.getHistoricOrders({
        category:'spot',
        orderId:orderId
      })
      const orderDetails = response?.result?.list[0]
    const result = {
      id:orderDetails.orderId,
      avgPrice: orderDetails.avgPrice, // avg execution price
      cost: orderDetails.cumExecValue, // total quote cost how much USDT was spent
      filled: orderDetails.cumExecQty, // total filled base quantity(eg: how much eth we got when buying)
      status: orderDetails.orderStatus,
      qty: orderDetails.qty, //         Total order requested amount
      fee: orderDetails.cumExecFee // total fee paid
    } 

      return response;
    } catch (error) {
      console.log(`Error while getting bybit order details: `, error);
    }
  }

  async getBalance() {
    try {
      const response = await this.client.getWalletBalance({
        // coin: "BTC",
        accountType: "UNIFIED",
      });
      return response;
    } catch (error) {
      console.error(`Error occured while fetching bybit balance: ${error}`);
      //throw error;
    }
  }

  async orderStatus() {
    const response = await this.client.getHistoricOrders({
      category: "spot",
      symbol: "SOLUSDT",
    });
    return response;
  }

  async exchangeQuote(symbol: exchangeQuoteSymbol) {
    const response = await this.client.getTickers({ category: "spot", symbol });
    return response;
  }

  async getOrderBook(
    symbol: string,
    depth = 20
  ): Promise<{ bids: [number, number][]; asks: [number, number][] }> {
    try {

      const response = await this.client.getOrderbook({
        category: "spot",
        symbol,
        limit: depth,
      });
      
      const bids = response.result.b.map(
        ([price, qty]: [string, string]) =>
          [Number(price), Number(qty)] as [number, number]
      );


      const asks = response.result.a.map(
        ([price, qty]: [string, string]) =>
          [Number(price), Number(qty)] as [number, number]
      );
      //console.log('bybit asks:---------->', bids);
      //console.log('bybit asks----------->', asks);
      return { bids, asks };
    } catch (error) {
      console.error("Error fetching order book:", error);
      return { bids: [], asks: [] };
    }
  }


  async crossExchangeTransfer(params:CrossExchangeTransferParams){
    const {coin, chain, address, amount, timestamp} = params
    try {
      const resp = await this.client.submitWithdrawal({
        coin:coin,
        chain:chain,
        address:address,
        amount:amount,
        timestamp:timestamp,
        accountType:'SPOT'
      })

      return resp;
    } catch (error) {
      console.log('Error while making a cross exchange from bybit: ', error);     
    }
  }

  connectTicker() {
    this.ws = new WebSocket(BYBIT_WS_URL!);

    this.ws.on("open", () => {
      console.log(`✅ Connected to bybit Testnet:}`);
      console.log(BYBIT_WS_URL);

      this.ws?.send(
        JSON.stringify({
          op: "subscribe",
          args: ["tickers.ETHUSDT", "tickers.BTCUSDT", "tickers.SOLUSDT"],
          // args: [ "orderbook.50.BTCUSDT","orderbook.50.ETHUSDT","orderbook.50.SOLUSDT"],
          req_id: "orderbook_sub",
        })
      );
    });

    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      console.log(msg);

      if (msg.topic?.startsWith("tickers")) {
        const symbol = msg.data.symbol; // e.g., ETHUSDT
        const price = parseFloat(msg.data.lastPrice); // last price

        console.log(`Price on Bybit ${symbol}: ${price}`);
      }
    });

    setInterval(() => {
      this.ws?.send(JSON.stringify({ op: "ping", req_id: "ping1" }));
    }, 20000);

    this.ws.on("close", () => {
      console.log("Connection closed. Reconnecting...");
      setTimeout(() => {
        this.ws = new WebSocket(BYBIT_WS_URL!);
      }, 1000);
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket Error:", err);
    });
  }

  disconnect() {
    this.ws?.close();
  }
}

export const bybitService = new BYbitService();
