import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { exchangeQuoteSymbol, Orderbook } from "./binance.types";
import QueryString from "qs";
import { order } from "../../transactions/transaction.type";

const {
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_BASE_URL,
  BINANCE_WS_URL,
} = process.env;

class BinanceService {
  private apiKey: string;
  private secret: string;
  private http: AxiosInstance;
  private ws: WebSocket | null = null;
  private orderbooks: Record<string, Orderbook> = {};

  constructor() {
    this.apiKey = BINANCE_API_KEY!;
    this.secret = BINANCE_API_SECRET!;
    this.http = axios.create({
      baseURL: BINANCE_BASE_URL || "https://api.binance.com",
      headers: { "X-MBX-APIKEY": this.apiKey },
      timeout: 10000,
    });
    this.ws = new WebSocket("wss://ws-api.binance.com:443/ws-api/v3", {
      headers: {
        "X-MBX-APIKEY": this.apiKey,
      },
    });
  }

  /** ============ REST ORDER METHODS ============ **/
  private sign(query: string) {
    return crypto.createHmac("sha256", this.secret).update(query).digest("hex");
  }

  private async buildQuery(params: Record<string, any>) {
    const serverTime = await axios.get(
      "https://testnet.binance.vision/api/v3/time"
    );
    params.timestamp = serverTime.data.serverTime;
    const kv = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join("&");
    const signature = this.sign(kv);
    return `${kv}&signature=${signature}`;
  }

  private async placeOrder(params: Record<string, any>) {
    const qs = await this.buildQuery(params);
    const url = `/api/v3/order?${qs}`;
    console.log("url------------------->",url)
    const res = await this.http.post(url,{});
    console.log("res---------------------->",res);
    return res.data;
  }

  async marketBuy(symbol: string, quantity: number) {
    try {
      const url = `${BINANCE_BASE_URL}/api/v3/order`
      const params = {
        symbol:symbol,
        side:'BUY',
        type:'MARKET',
        quantity:quantity,
        timestamp:Date.now()
      }
      const queryString = QueryString.stringify(params);
      const signature = crypto.createHmac("sha256", this.secret).update(queryString).digest("hex");
      const finalUrl = `${url}?${queryString}&signature=${signature}`;

      const response = await axios.post(finalUrl, null, {
      headers: {
        "X-MBX-APIKEY": this.apiKey
      }
    });
    const status = response?.data.status==='FILLED'?'SUCCESS':'FAILED'
    const result:order = {
      status:status,
      orderId:response?.data?.orderId,
      amount:response?.data?.fills[0]?.qty, // loop it if there are multiple fills
      price:response?.data?.cummulativeQuoteQty,
      time:response?.data?.workingTime,
    } 
    console.log(result);

    console.log(response?.data);
    return result;
    } catch (error:any) {
      //console.log(`Error occured while binance market buy: `, error.response.data);
      return error.response.data;
    }
    
  }
    

  async marketSell(symbol: string, quantity: number) {
    try {
      const url = `${BINANCE_BASE_URL}/api/v3/order`;
      const params = {
        symbol:symbol,
        side:'SELL',
        type:'MARKET',
        quantity:quantity,
        timestamp:Date.now()
      }
      const queryString = QueryString.stringify(params);
      const signature = crypto.createHmac('sha256',this.secret).update(queryString).digest('hex');
      const finalUrl = `${url}?${queryString}&signature=${signature}`;
      
      const response = await axios.post(finalUrl, null, {
        headers:{
          "X-MBX-APIKEY": this.apiKey
        }
      })
       const status = response?.data.status==='FILLED'?'SUCCESS':'FAILED'
      const result:order = {
      status:status,
      orderId:response?.data?.orderId,
      amount:response?.data?.fills[0]?.qty, // loop it if there are multiple fills
      price:response?.data?.cummulativeQuoteQty,
      time:response?.data?.workingTime
    } 
      console.log(response.data);
      return result;
    } catch (error:any) {
      console.log(`Error occured while binance market sell: `, error);
      return error.response.data;
    }
  }

  async cancelOrder(){
    try {
      //const response = await this.client.restAPI
    } catch (error) {
      
    }
  }

  async exchangeQuote(symbol: exchangeQuoteSymbol) {
    try {
      const url = `${BINANCE_BASE_URL}/api/v3/ticker/price`;
      const response = await axios.get(url, {
        params: {
          symbol: symbol,
        },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getOrderBook(symbol: string, limit = 20) {
    try {
      const url = `${BINANCE_BASE_URL}/api/v3/depth?symbol=${symbol}&limit=${limit}`;
      const res = await axios.get(url);

      const orderbook: Orderbook = {
        bids: res.data.bids.map(([price, qty]: [string, string]) => [
          Number(price),
          Number(qty),
        ]),
        asks: res.data.asks.map(([price, qty]: [string, string]) => [
          Number(price),
          Number(qty),
        ]),
      };
      //console.log("orderbook binance------------->", orderbook);
      this.orderbooks[symbol.toLowerCase()] = orderbook;
      return orderbook;
    } catch (err) {
      console.error("Error fetching orderbook:", err);
      return { bids: [], asks: [] };
    }
  }

  async getBalance(){
    try {
      const params = {
        timestamp:Date.now(),
      }
      const url = `${BINANCE_BASE_URL}/api/v3/account`
      const queryString = QueryString.stringify(params);
      const signature = crypto.createHmac("sha256", this.secret).update(queryString).digest("hex");
      const finalUrl = `${url}?${queryString}&signature=${signature}`;
      const response = await axios.get(finalUrl, {
      headers: {
        "X-MBX-APIKEY": this.apiKey
      }
    })
    return response;
    } catch (error) {
      console.log(`Error occured while getting binance balance: `,error);
    }
  }

  /** ============ WEBSOCKET METHODS ============ **/
  connectTicker(symbols: string[] = ["btcusdt", "ethusdt", "solusdt"]) {
    const streams = symbols.map((s) => `${s}@ticker`).join("/");
    this.ws = new WebSocket(`${BINANCE_WS_URL}/${streams}`);

    this.ws.on("open", () => {
      console.log("✅ Connected to Binance WS");
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const stream = msg.stream; // e.g., btcusdt@ticker
      const price = msg.data.c; // last price
      console.log(`📊 ${stream}: ${price}`);
      console.log("msg----->", msg);
    });

    this.ws.on("error", (err) => {
      console.error("❌ Binance WS Error:", err);
    });

    this.ws.on("close", () => {
      console.log("🔌 Binance WS Connection Closed");
    });
  }

  disconnect() {
    this.ws?.close();
  }

  async userDataStream() {}
}

export const binanceService = new BinanceService();
