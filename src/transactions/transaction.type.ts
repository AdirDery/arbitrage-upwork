export type transaction = {
  type: "direct" | "triangular";
  sequenceId: string;
  leg: number;
  symbol: string;
  side: "BUY" | "SELL";
  price?: number;
  quantity: number;
  status?: "PENDING" | "SUCCESS" | "FAILED";
  responseMsg?:string;
  errorMsg?: string;
  orderId?: string;
  exchange?:string;
  assetGiven?:string;
  assetReceived?:string;
  // amountGiven?:number;
  // amountReceived?:number;
  timestamp: number;
};


export type order = {
  msg?:string;
  status?:string;
  orderId?:string;
  amount?:string;
  price?:string;
  orderLinkId?:string;
  time?:number;
}