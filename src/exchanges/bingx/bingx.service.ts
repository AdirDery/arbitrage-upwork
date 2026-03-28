import WebSocket from "ws";
import zlib from "zlib";
import CryptoJS from "crypto-js";
import axios, { AxiosRequestConfig } from "axios";
import { APIRequest, bingXQuoteSymbol } from "./bingx.types";
import { ChannelPayload } from "./bingx.types";
import { formatSymbol } from "../../utils/general.utils";

class BingXServices {
  private socket!: WebSocket;
  private readonly path = "wss://open-api-swap.bingx.com/swap-market";
  private receivedMessage = "";
  private apiKey: string;
  private apiSecret: string;
  private host: string;
  // private API:APIRequest

  private readonly channels: ChannelPayload[] = [
    {
      id: "24dd0e35-56a4-4f7a-af8a-394c7060909c",
      reqType: "sub",
      // dataType: "BTC-USDT@lastPrice",
      dataType: "SOL-USDT@ticker",
    },
    {
      id: "24dd0e35-56a4-4f7a-af8a-394c7060909c",
      reqType: "sub",
      // dataType: "BTC-USDT@lastPrice",
      dataType: "ETH-USDT@ticker",
    },
    {
      id: "24dd0e35-56a4-4f7a-af8a-394c7060909c",
      reqType: "sub",
      // dataType: "BTC-USDT@lastPrice",
      dataType: "BTC-USDT@ticker",
    },
  ];

  constructor() {
    // this.init();
    this.host = "open-api.bingx.com";
    this.apiSecret = process.env.BINGX_SECRET as string;
    this.apiKey = process.env.BINGX_API_KEY as string;
  }

  private getParameters(
    api: APIRequest,
    timestamp: number,
    urlEncoded: boolean
  ) {
    let parameters = "";
    for (const key in api.payload) {
      const value = (api.payload as any)[key];
      if (urlEncoded) {
        parameters += key + "=" + encodeURIComponent(value) + "&";
      } else {
        parameters += key + "=" + value + "&";
      }
    }

    if (parameters) {
      parameters = parameters.substring(0, parameters.length - 1);
      parameters = parameters + "&timestamp=" + timestamp;
    } else {
      parameters = "timestamp=" + timestamp;
    }

    return parameters;
  }

  private sign(params: string): string {
    return CryptoJS.enc.Hex.stringify(
      CryptoJS.HmacSHA256(params, this.apiSecret)
    );
  }

  async sendRequest(api: APIRequest) {
    const timestamp = Date.now();
    const params = this.getParameters(api, timestamp, true);
    const sign = this.sign(this.getParameters(api, timestamp, false)); // Check this boolean flag if the urlEncoded has special chars
    const url = `${api.protocol}://${this.host}${api.uri}?${params}&signature=${sign}`;

    const config: AxiosRequestConfig = {
      method: api.method,
      url,
      headers: {
        "X-BX-APIKEY": this.apiKey,
      },
    };

    const resp = await axios(config);
    return resp.data;
  }

  async marketBuy(symbol: string, quantity: number) {
    const newSymbol = await formatSymbol(symbol);
    const api: APIRequest = {
      uri: "/openApi/spot/v1/trade/order",
      method: "POST",
      payload: {
        type: "MARKET",
        symbol: newSymbol,
        side: "BUY",
        quantity: quantity,
        recvWindow: 5000,
        timeInForce: "GTC",
        timestamp: Date.now(),
      },
      protocol: "https",
    };

    return this.sendRequest(api);
  }

  async marketSell(symbol: string, quantity: number) {
    const newSymbol = await formatSymbol(symbol);

    const api: APIRequest = {
      uri: "/openApi/spot/v1/trade/order",
      method: "POST",
      payload: {
        type: "MARKET",
        symbol: newSymbol,
        side: "SELL",
        quantity: quantity,
        recvWindow: 5000,
        timeInForce: "GTC",
        timestamp: Date.now(),
      },
      protocol: "https",
    };

    return this.sendRequest(api);
  }

  async cancelOrder(orderId:string){
    const api:APIRequest = {
      uri:'/openApi/spot/v1/trade/cancel',
      method:'POST',
      payload:{
        "orderId": orderId,
        "symbol": "NEMS-USDT",
        "timestamp": Date.now()
      },
      protocol:'https'
    }
  }

  async checkBalance(asset?: string) {
    const api: APIRequest = {
      uri: "/openApi/spot/v1/account/balance",
      method: "GET",
      payload: {},
      protocol: "https",
    };

    const response = await this.sendRequest(api);

    if (asset) {
      const balance = response.data.find((b: any) => b.asset === asset);
      return balance || { asset, free: "0", locked: "0" };
    }

    return response;
  }

  async exchangeQuote(symbol: bingXQuoteSymbol) {
    const newSymbol = formatSymbol(symbol);
    const url = `https://open-api.bingx.com/openApi/spot/v1/ticker/price`;
    const response = await axios.get(url, {
      params: { newSymbol },
    });
    return response?.data?.data[0].trades;
  }

  async getOrderbook(symbol: string) {
    const newSymbol = await formatSymbol(symbol);
    const api: APIRequest = {
      uri: "/openApi/spot/v1/market/depth",
      method: "GET",
      payload: {
        symbol: newSymbol,
        limit: "20",
        type: "step5",
      },
      protocol: "https",
    };
    try {
      const response = await this.sendRequest(api);
      const orderbook = {
        bids: response.data.bids.map(([price, qty]: [string, string]) => [
          Number(price),
          Number(qty),
        ]),
        asks: response.data.asks.map(([price, qty]: [string, string]) => [
          Number(price),
          Number(qty),
        ]),
      };
      //console.log("bingx bids--------------->",orderbook.bids)
      //console.log("bingx asks--------------->",orderbook.asks)

      return orderbook;
    } catch (error) {
      console.log(`Error while fetching bingx: `, error);
      return { bids: [], asks: [] };
    }
  }

  async crossExchangeTransfer(address:string, amount:string, coin:string) {
    const timestamp = Date.now();
    const api: APIRequest = {
      uri: "/openApi/wallets/v1/capital/withdraw/apply",
      method: "POST",
      payload: {
        address: address,
        addressTag: "None",
        amount: amount,
        coin: coin,
        network: "BEP20",
        timestamp: timestamp,
        walletType: "1",
      },
      protocol: "https",
    };
    try {
      const response = await this.sendRequest(api);
      console.log(response);
      return response;
    } catch (error) {
      console.log(`Error while cross exchange transfer from BingX: `,error);
    }
  }



  /** ============ WEBSOCKET METHODS ============ **/

  public connectTicker(): void {
    this.init();
  }

  private init(): void {
    this.socket = new WebSocket(this.path);

    this.socket.on("open", () => this.onOpen());
    this.socket.on("message", (msg) => this.onMessage(msg));
    this.socket.on("error", (err) => this.onError(err));
    // this.socket.on("close", () => this.onClose());
  }

  private onOpen(): void {
    console.log("✅ WebSocket connected");
    this.channels.forEach((channel) =>
      this.socket.send(JSON.stringify(channel))
    );
  }

  private onError(error: Error): void {
    console.error("❌ WebSocket error:", error);
  }

  private onMessage(message: WebSocket.RawData): void {
    try {
      const buf = Buffer.isBuffer(message)
        ? message
        : Buffer.from(message as any);
      const decodedMsg = zlib.gunzipSync(buf).toString("utf-8");

      console.log("📩 Message:", decodedMsg);

      if (decodedMsg === "Ping") {
        this.socket.send("Pong");
        console.log("Pong sent ✅");
      }

      this.receivedMessage = decodedMsg;
    } catch (err) {
      console.error("⚠️ Error decoding message:", err);
    }
  }

  // private onClose(): void {
  //   console.log("🔌 WebSocket closed");
  // }

  public getLastMessage(): string {
    return this.receivedMessage;
  }
}

// Run the client
export const bingxService = new BingXServices();
