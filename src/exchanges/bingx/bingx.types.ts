
export interface ChannelPayload {
  id: string;
  reqType: string;
  dataType: string;
}

export interface TradePayload {
  type: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  newClientOrderId?: string;
  recvWindow: number; //The request will only be valid if BingX receives it within 1 second of your local timestamp
  timeInForce: string;   //assign it GTC good till cancelled, it is relevant for limit orders, but not for market as they are executed immideatly
  timestamp: number;
  address?:string;
  addressTag?:string;
  amount?:string;
  coin?:string;
  network?:string;
  walletType?:string
}

export interface APIRequest {
  uri: string;
  method: "POST" | "GET" | "DELETE";
  payload: TradePayload | Record<string, any>;
  protocol: "https" | "http";
}


export type bingXQuoteSymbol = "SOL-USDT" | "ETH-USDT" | "BTC-USDT";
