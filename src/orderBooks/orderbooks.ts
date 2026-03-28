import chalk from "chalk";
import { orderbookSide } from "./ordrbooks.types";
import { Config } from "../config/config.model";
import logger from "../core/logger.service";


class Orderbooks {
  constructor() {
    console.log(chalk.whiteBright("[Orderbooks] Initialized Orderbooks instance"));
  }

  async avgPriceFromBook(bookSide: orderbookSide, size: number) {
    console.log(chalk.whiteBright(`[avgPriceFromBook] Calculating avg price for size: ${chalk.yellowBright(size)}`));
    let remaining = size; // how much of the order is still left to fill
    let cost = 0; // total cost (price*amount) so far
    let consumed = 0; // how much of the requested size is filled so far

    for (const [price, levelSize] of bookSide) {
      if (remaining <= 0) {
        console.log(chalk.whiteBright("[avgPriceFromBook] Order fully consumed, stopping iteration"));
        break;
      }

      const take = Math.min(levelSize, remaining); // how much we can take from this level
      cost += take * price; // add cost of this portion
      consumed += take; // add to filled amount
      remaining -= take; // reduce remaining amount to fill

      console.log(chalk.whiteBright(
        `[avgPriceFromBook] Taking ${chalk.yellowBright(take)} @ ${chalk.yellowBright(price)}, total consumed: ${chalk.yellowBright(consumed)}, remaining: ${chalk.yellowBright(remaining)}`
      ));
    }

    if (consumed < size) {
      console.warn(chalk.bgRed.white.bold(
        `[avgPriceFromBook] ⚠ Insufficient liquidity. Requested: ${size}, Filled: ${consumed}`
      ));
      return { avgPrice: Number.POSITIVE_INFINITY, consumed }; // insufficient liquidity
    }

    const avgPrice = cost / size;
    console.log(chalk.whiteBright(`[avgPriceFromBook]  Avg price calculated: ${chalk.yellowBright(avgPrice.toFixed(8))}, Total consumed: ${chalk.yellowBright(consumed)}`));
    return { avgPrice, consumed };
  }

  async calculateProfit(
    buyPrice: number, // avg price to pay per unit to buy (already includes orderbook depth/slippage)
    sellPrice: number, // avg price to pay per unit to sell (already includes orderbook depth/slippage)
    size: number, // how many units you are trading
    buyFee: number, // fraction fee on buy (taker)
    sellFee: number // fraction fee on sell (taker)
  ) {
    // NOTE: buyPrice and sellPrice come from avgPriceFromBook() which walks the orderbook.
    // The orderbook walk already accounts for slippage (market depth impact).
    // We only apply trading fees here — NO additional slippage percentage.
    const cost = buyPrice * size;
    const costWithFee = cost * (1 + buyFee);
    const proceeds = sellPrice * size;
    const proceedsAfterFee = proceeds * (1 - sellFee);
    const netProfit = proceedsAfterFee - costWithFee;
    const roi = netProfit / costWithFee;

    const profitIcon = netProfit >= 0 ? "✅" : "❌";
    const color = netProfit >= 0 ? chalk.greenBright.bold : chalk.redBright;

    logger.info(`[calculateProfit] Buy: ${buyPrice}, Sell: ${sellPrice}, Size: ${size}, BuyFee: ${buyFee}, SellFee: ${sellFee}`);
    console.log(
     color(`[calculateProfit] ${profitIcon} NetProfit: ${netProfit.toFixed(4)}, ROI: ${(roi * 100).toFixed(4)}%, Cost: ${costWithFee.toFixed(4)}, Proceeds: ${proceedsAfterFee.toFixed(4)}`)
    );

    return { netProfit, roi, cost: costWithFee, proceeds: proceedsAfterFee };
  }
}

export const orderBooks = new Orderbooks();
