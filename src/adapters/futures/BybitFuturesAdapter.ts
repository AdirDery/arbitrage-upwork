import { RestClientV5 } from "bybit-api";
import { IFuturesAdapter, FundingRateInfo, FuturesOrderResult, PositionInfo } from "./IFuturesAdapter";
import logger from "../../core/logger.service";

/**
 * Bybit perpetual futures adapter.
 * Uses the bybit-api SDK which already supports linear perpetuals.
 */
export class BybitFuturesAdapter implements IFuturesAdapter {
  readonly name = "Bybit";
  private client: RestClientV5;

  constructor() {
    this.client = new RestClientV5({
      key: process.env.BYBIT_API_KEY as string,
      secret: process.env.BYBIT_SECRET as string,
      recv_window: 10000,
    });
  }

  async getFundingRate(symbol: string): Promise<FundingRateInfo> {
    try {
      const response = await this.client.getTickers({ category: "linear", symbol });
      const ticker = response.result.list[0];

      return {
        symbol,
        currentRate: Number(ticker.fundingRate),
        nextRate: Number(ticker.fundingRate), // Bybit provides current rate
        nextFundingTime: Number(ticker.nextFundingTime),
        interval: 8,
      };
    } catch (err) {
      logger.error(`[BybitFutures] Error getting funding rate for ${symbol}`, err);
      return { symbol, currentRate: 0, nextRate: 0, nextFundingTime: 0, interval: 8 };
    }
  }

  async getNextFundingRate(symbol: string): Promise<number> {
    const info = await this.getFundingRate(symbol);
    return info.nextRate;
  }

  async openShort(symbol: string, size: number, leverage: number = 1): Promise<FuturesOrderResult> {
    try {
      // Set leverage first
      await this.client.setLeverage({ category: "linear", symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) });

      const response = await this.client.submitOrder({
        category: "linear",
        symbol,
        side: "Sell",
        orderType: "Market",
        qty: String(size),
      });

      return {
        success: !!response.result.orderId,
        orderId: response.result.orderId,
        symbol,
        side: "SHORT",
        size,
        avgPrice: 0, // filled async
      };
    } catch (err: any) {
      logger.error(`[BybitFutures] Error opening short ${symbol}`, err);
      return { success: false, orderId: "", symbol, side: "SHORT", size, avgPrice: 0, error: err.message };
    }
  }

  async closePosition(symbol: string): Promise<FuturesOrderResult> {
    try {
      const position = await this.getPositionInfo(symbol);
      if (!position || position.side === "NONE") {
        return { success: true, orderId: "no_position", symbol, side: "SHORT", size: 0, avgPrice: 0 };
      }

      // Close by submitting opposite order
      const closeSide = position.side === "SHORT" ? "Buy" : "Sell";
      const response = await this.client.submitOrder({
        category: "linear",
        symbol,
        side: closeSide,
        orderType: "Market",
        qty: String(position.size),
        reduceOnly: true,
      });

      return {
        success: !!response.result.orderId,
        orderId: response.result.orderId,
        symbol,
        side: position.side,
        size: position.size,
        avgPrice: position.entryPrice,
      };
    } catch (err: any) {
      logger.error(`[BybitFutures] Error closing position ${symbol}`, err);
      return { success: false, orderId: "", symbol, side: "SHORT", size: 0, avgPrice: 0, error: err.message };
    }
  }

  async getPositionInfo(symbol: string): Promise<PositionInfo | null> {
    try {
      const response = await this.client.getPositionInfo({ category: "linear", symbol });
      const pos = response.result.list[0];
      if (!pos || Number(pos.size) === 0) return null;

      return {
        symbol,
        side: pos.side === "Buy" ? "LONG" : "SHORT",
        size: Number(pos.size),
        entryPrice: Number(pos.avgPrice),
        markPrice: Number(pos.markPrice),
        unrealizedPnl: Number(pos.unrealisedPnl),
        leverage: Number(pos.leverage),
        liquidationPrice: Number(pos.liqPrice),
        marginUsed: Number(pos.positionIM),
      };
    } catch (err) {
      logger.error(`[BybitFutures] Error getting position info ${symbol}`, err);
      return null;
    }
  }

  async getFuturesOrderbook(symbol: string): Promise<{ bids: [number, number][]; asks: [number, number][] }> {
    try {
      const response = await this.client.getOrderbook({ category: "linear", symbol, limit: 20 });
      const bids = response.result.b.map(([p, q]: [string, string]) => [Number(p), Number(q)] as [number, number]);
      const asks = response.result.a.map(([p, q]: [string, string]) => [Number(p), Number(q)] as [number, number]);
      return { bids, asks };
    } catch (err) {
      return { bids: [], asks: [] };
    }
  }

  async getFuturesBalance(): Promise<Record<string, number>> {
    try {
      const response = await this.client.getWalletBalance({ accountType: "UNIFIED" });
      const balances: Record<string, number> = {};
      for (const coin of response.result.list[0]?.coin || []) {
        if (Number(coin.walletBalance) > 0) {
          balances[coin.coin] = Number(coin.walletBalance);
        }
      }
      return balances;
    } catch (err) {
      return {};
    }
  }
}
