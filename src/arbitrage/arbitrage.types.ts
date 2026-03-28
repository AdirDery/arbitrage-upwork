// adapters/exchangeAdapter.ts
import { orderbookSide } from "../orderBooks/ordrbooks.types";

export interface ExchangeAdapter {
  name: string;
  getOrderbook(symbol: string): Promise<{ bids: orderbookSide; asks: orderbookSide }>;
  marketBuy(symbol: string, size: number): any;
  marketSell(symbol: string, size: number): any;
  getFees(symbol?: string): Promise<{ taker: number, maker:number }>;
  getBalance(asset: string): Promise<number>;
  minOrderSize(symbol: string): number;
  //cancelOrder(orderId:string):Promise<any>;
  getOrderDetails(orderId:string, symbol:string):Promise<any>
}

export type ArbOpportunity = {
  buyExchange: ExchangeAdapter;
  sellExchange: ExchangeAdapter;
  symbol: string;
  size: number;
  netProfit: number;
  roi: number;
  cost: number;
  proceeds: number;
};


