import WebSocket from "ws";
import { RestClient } from "okx-api";
import axios from "axios";
import CryptoJS from "crypto-js";
import { inspect } from "util";
import { formatSymbol } from "../../utils/general.utils";
import { order } from "../../transactions/transaction.type";

interface SubscribeMsg {
  op: string;
  args: { channel: string; instId: string }[];
}

export class OKXService {
  private socket!: WebSocket;
  private readonly url = "wss://wspap.okx.com:8443/ws/v5/public?brokerId=9999";
  private readonly symbols = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
  private client: RestClient;
  private BASE_URL_OKX: string;
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;

  constructor() {
    //this.init();
    this.BASE_URL_OKX = process.env.BASE_URL_OKX as string;
    this.apiKey = process.env.OKX_API_KEY as string;
    this.secretKey = process.env.OKX_SECRET as string;
    this.passphrase = process.env.OKX_PASSPHRASE as string;

    this.client = new RestClient({
      apiKey: process.env.OKX_API_KEY,
      apiSecret: process.env.OKX_SECRET,
      apiPass: process.env.OKX_PASSPHRASE,
      //demoTrading:true
    });
  }

  getSignature(
    timestamp: string,
    method: string,
    requestPath: string,
    body: object | null,
    secretKey: string
  ) {
    const bodyString = body ? JSON.stringify(body) : "";
    const prehash = timestamp + method.toUpperCase() + requestPath + bodyString;
    const hash = CryptoJS.HmacSHA256(prehash, secretKey);
    return CryptoJS.enc.Base64.stringify(hash);
  }

  async marketBuy(instId: string, quantity: string) {
    //instId = 'BTC-USDT'
    const newSymbol = await formatSymbol(instId);

    try {
      const response = await this.client.submitOrder({
        instId:newSymbol,
        tdMode:'cash',        //cash is for spot trade
        clOrdId:'b12',        //order id, we can also define it to track on our own
        side:'buy',
        ordType:'market',
        sz:quantity,           // quantity to buy or sell
      })

      

      const result:order ={
        msg:response[0].sMsg,
        orderId:response[0].ordId,
        time:Number(response[0]?.ts),
      } 
      return result;
    } catch (error) {
      console.error("OKX Market Buy Error:", error);
      //throw error;
    }
  }

  async marketSell(instId: string, quantity: string) {
    const newSymbol = await formatSymbol(instId);
    try {
      const response = await this.client.submitOrder({
        instId: newSymbol,
        tdMode: "cash",
        clOrdId: "b12",
        side: "sell",
        ordType: "market",
        sz: quantity,
      });
      const result:order ={
        msg:response[0].sMsg,
        orderId:response[0].ordId,
        time:Number(response[0]?.ts),
      } 
      return result;    } catch (error) {
      console.error("OKX Market Sell Error:", error);
      //throw error;
    }
  }


  async cancelOrder(instId:string, ordId:string,clOrdId:string ){
    const newSymbol = await formatSymbol(instId);
    try {
      const response = await this.client.cancelOrder({
      instId: newSymbol,
      ordId: ordId,
      clOrdId: clOrdId
      })

      return response;
    } catch (error) {
      console.log(`Error occured while okx cancel order: ` ,error);
    }
  }

  async getBalance() {
    try {
    const response = await this.client.getBalance();
    return response;      
    } catch (error) {
      console.log(`Error occured while getting okx balance`, error);
    }

  }

  async getOrderBooks(symbol: string) {
    const newSymbol = await formatSymbol(symbol);

    try {
      const response = await this.client.getOrderBook({
        instId: newSymbol,
        sz:'20'
      });

      const bids = response[0].bids.map(
        ([price, qty, liquidateOrder, orderCount]:[string,string,string,string])=>
        [Number(price), Number(qty)] as [number, number]
      );


      const asks = response[0].asks.map(
        ([price, qty, liquidateOrder, orderCount]:[string,string,string,string])=>
        [Number(price), Number(qty)] as [number, number]
      );

      return { bids, asks };
      //console.log(response);
    } catch (error) {
      console.log(`Error while fetching OKX orderbooks: `, error);
      return {bids:[], asks:[]}
    }
  }

  async getInstruments(){
    const response = await this.client.getAccountInstruments({instType:'SPOT', uly:'BTC-USDT'});
    console.log(`OKX get instruments: ------>`,response);
  }

  

  /** ============ WEBSOCKET METHODS ============ **/

  public connectTicker(): void {
    this.init();
  }

  private init(): void {
    this.socket = new WebSocket(this.url);

    this.socket.on("open", () => this.onOpen());
    this.socket.on("message", (msg) => this.onMessage(msg));
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("close", () => this.onClose());
  }

  private onOpen(): void {
    console.log("✅ OKX Demo WebSocket connected");

    const subscribeMsg: SubscribeMsg = {
      op: "subscribe",
      args: this.symbols.map((sym) => ({
        channel: "tickers",
        instId: sym,
      })),
    };

    this.socket.send(JSON.stringify(subscribeMsg));
  }

  private onMessage(message: any): void {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.arg && msg.data) {
        msg.data.forEach((ticker: any) => {
          console.log(`📈 ${ticker.instId} last price: ${ticker.last}`);
        });
      } else if (msg.event) {
        console.log("⚡ Event:", msg.event, msg.arg || "");
      }
    } catch (err) {
      console.error("⚠️ Error parsing message:", err);
    }
  }

  private onError(error: Error): void {
    console.error("❌ WebSocket error:", error.message);
  }

  private onClose(): void {
    console.log("🔌 WebSocket connection closed");
  }
}


export const okxservice = new OKXService();