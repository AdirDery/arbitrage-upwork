import { UserPreferences } from "../config/config.model";
import { exchangeSymbols } from "./symbols";

// Only include paths where all symbols actually exist in exchangeSymbols.
// BTCSOL, BTCETH, ETHSOL do NOT exist on any configured exchange — removed.
// Valid cross pairs: SOLBTC (Binance,Mexc,Bybit,Okx), SOLETH (Binance,Okx), ETHBTC (all)
export const basePaths = [
  ["SOLUSDT", "SOLBTC", "BTCUSDT"],   // USDT→SOL→BTC→USDT
  ["SOLUSDT", "SOLETH", "ETHUSDT"],   // USDT→SOL→ETH→USDT (Binance/Okx only)
  ["ETHUSDT", "ETHBTC", "BTCUSDT"],   // USDT→ETH→BTC→USDT
];

//const exchanges = ["Binance", "Mexc", "Bingx", "Bybit", "Okx"];


export async function generateCrossExchangePaths(
  exchangeSymbols: Record<string, string[]>,
  basePaths: string[][]
): Promise<{ exchange: string; symbol: string; direction: string }[][]> {
  const result: { exchange: string; symbol: string; direction: string }[][] =
    [];
  
  const user = await UserPreferences.findOne();
  const exchanges = user?.selectedExchanges || [];  
  for (const path of basePaths) {
    for (const ex1 of exchanges) {
      for (const ex2 of exchanges) {
        for (const ex3 of exchanges) {
          if (
            exchangeSymbols[ex1]?.includes(path[0]) &&
            exchangeSymbols[ex2]?.includes(path[1]) &&
            exchangeSymbols[ex3]?.includes(path[2])
          ) {
            result.push([
              { exchange: ex1, symbol: path[0], direction: "BUY" },
              { exchange: ex2, symbol: path[1], direction: "SELL" },
              { exchange: ex3, symbol: path[2], direction: "SELL" },
            ]);
          }
        }
      }
    }
  }
  return result;
}
