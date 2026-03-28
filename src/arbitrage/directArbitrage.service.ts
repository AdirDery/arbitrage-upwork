import { ExchangeAdapter, ArbOpportunity } from "./arbitrage.types";
import { orderBooks } from "../orderBooks/orderbooks";
import { getSymbolsOnEveryExchange } from "../paths/symbols";
import { Transactions } from "../transactions/transaction.service";
import logger from "../core/logger.service";
import chalk from "chalk";


export class Arbitration {
  private scannerSignal = { active: true };
  public trade:'auto' | 'manual'= 'manual';
  constructor(
    private bot:any,
    private transactions:Transactions,
    private showAlerts?: (chatId:string, message:any) => Promise<void>,
    private ShowAlertsWithAutoTrades?: (chatId:string, message:any) => Promise<void>,
  ) {
    //console.log(chalk.cyanBright("[Arbitration] Initialized arbitration instance"));
    logger.info("[Arbitration] Initialized arbitration instance");
  }

  async evaluateArbitrarge(
    buyEx: ExchangeAdapter,
    sellEx: ExchangeAdapter,
    symbol: string,
    size: number
  ): Promise<ArbOpportunity | null> {
    console.log(chalk.whiteBright(`\n[evaluateArbitrarge]🔍 Evaluating ${chalk.yellow(symbol)} | Size: ${chalk.yellow(size)}`));
    console.log(chalk.whiteBright(`Checking buy ↔️  on ${chalk.yellowBright(buyEx.name)} and -> sell on ${chalk.yellowBright(sellEx.name)}`));
    //logger.info(`[evaluateArbitrarge]🔍 Evaluating ${symbol} | Size: ${size}`)
    //logger.info(`Checking buy ↔️  on ${buyEx.name} and -> sell on ${sellEx.name}`)

    // Fetch both orderbooks in parallel to cut latency in half
    const [buyBook, sellBook] = await Promise.all([
      buyEx.getOrderbook(symbol),
      sellEx.getOrderbook(symbol)
    ]);
    buyBook.asks.sort((a, b) => a[0] - b[0]);
    sellBook.bids.sort((a, b) => b[0] - a[0]); // ensure bids sorted descending
    console.log(chalk.whiteBright(`[evaluateArbitrarge] Buy orderbook fetched. Top 3 asks:`, chalk.yellowBright(buyBook.asks.slice(0, 3))));
    console.log(chalk.whiteBright(`[evaluateArbitrarge] Sell orderbook fetched. Top 3 bids:`, chalk.yellowBright(sellBook.bids.slice(0, 3))));
    //logger.info(`[evaluateArbitrarge] Sell orderbook fetched. Top 3 bids:`, sellBook.bids.slice(0, 3))
    // console.log("sellbook------------>",sellBook);

    const buyEst = await orderBooks.avgPriceFromBook(buyBook.asks, size);
    console.log(chalk.whiteBright(`[evaluateArbitrarge] Estimated buy price:`, chalk.yellowBright(JSON.stringify(buyEst))));
    //logger.info(`[evaluateArbitrarge] Estimated buy price: ${JSON.stringify(buyEst)}`);

    const sellEst = await orderBooks.avgPriceFromBook(sellBook.bids, size);
    console.log(chalk.whiteBright(`[evaluateArbitrarge] Estimated sell price:`, chalk.yellowBright(JSON.stringify(sellEst))));
    //logger.info(`[evaluateArbitrarge] Estimated sell price: ${JSON.stringify(sellEst)}`);

    logger.info(`[Evaluate Arbitrage] symbol: ${symbol}  |  size: ${size}  |  buy: ${buyEx.name}  |  sell: ${sellEx.name}  EstimatedBuyPrice: ${JSON.stringify(buyEst)}  |  EstimatedSellPrice: ${JSON.stringify(sellEst)}`)
    if (!isFinite(buyEst.avgPrice) || !isFinite(sellEst.avgPrice)) {
     console.log(chalk.whiteBright("⚠️ [evaluateArbitrarge] Invalid avg price, skipping arbitrage"));
    //logger.info("⚠️ [evaluateArbitrarge] Invalid avg price, skipping arbitrage");
      return null;
    }

    // Market orders are always TAKER orders (taking liquidity from the book)
    const [buyFees, sellFees] = await Promise.all([buyEx.getFees(symbol), sellEx.getFees(symbol)]);
    const buyFee = buyFees.taker;
    const sellFee = sellFees.taker;

    console.log(chalk.whiteBright(`[evaluateArbitrarge]💰 Buy Fee: ${chalk.yellowBright(buyFee)}, Sell Fee: ${chalk.yellowBright(sellFee)}`));
    //logger.info(`[evaluateArbitrarge]💰 Buy Fee: ${buyFee}, Sell Fee: ${sellFee}`);

    const { netProfit, roi, cost, proceeds } = await orderBooks.calculateProfit(
      buyEst.avgPrice,
      sellEst.avgPrice,
      size,
      buyFee,
      sellFee
    );

    console.log(chalk.whiteBright(`[evaluateArbitrarge] Calculated Profit: Net=${chalk.yellowBright(netProfit)}, ROI=${chalk.yellowBright(roi)}%\n`));
    //logger.info(`[evaluateArbitrarge] Calculated Profit: Net=${netProfit}, ROI=${roi}%`);
    logger.info(`[evaluateArbitrarge] buyFee: ${buyFee}  |  sellFee: ${sellFee}  |  netProfit: ${netProfit}  |  roi: ${roi}`)
    return {
      buyExchange: buyEx,
      sellExchange: sellEx,
      symbol,
      size,
      netProfit,
      roi,
      cost,
      proceeds,
    };
  }

    async startScanner() {
    this.scannerSignal.active = true;
    console.log("🟢 Direct Arbitrage Scanner signal set to true — starting loop.");
    logger.info("🟢 Direct Arbitrage Scanner signal set to true — starting loop.");
  }

  async stopScanner() {
    this.scannerSignal.active = false;
    console.log("🛑 Direct Arbitrage Scanner signal set to false — stopping loop.");
    logger.info("🛑 Direct Arbitrage Scanner signal set to false — stopping loop.")
  }

  async ArbitrationScanner(
    exchanges: ExchangeAdapter[],
    //symbol: string,
    size: number,
    profitThreshold:number,
    chatId:any,
  ): Promise<ArbOpportunity[]> {
    
    let opportunityToReturn: ArbOpportunity[] = [];
    while (this.scannerSignal.active){
    const opportunity: ArbOpportunity[] = [];
    const symbols = await getSymbolsOnEveryExchange();
    const selectedSymbols = symbols?.selectedSymbols || [];
    for (let i = 0; i < exchanges.length; i++) {
      for (let j = 0; j < exchanges.length; j++) {
        if (i === j) continue;
        console.log("\n===========================================================================\n");
        for(const symbol of selectedSymbols){
          //console.log(chalk.whiteBright(`[ArbitrationScanner] Scanning opportunities for ${chalk.yellowBright(symbol)} | Size: ${chalk.yellowBright(size)}`));  
          //console.log(chalk.whiteBright(`\n[ArbitrationScanner] Evaluating pair: Buy ${chalk.yellowBright(exchanges[i].name)}, Sell ${chalk.yellowBright(exchanges[j].name)}`));
          logger.info(`[ArbitrationScanner] Scanning opportunities for ${symbol} | Size: ${size}  |  Buy ${exchanges[i].name}   |  Sell ${exchanges[j].name}  |  Profit threshold: $ ${profitThreshold}`);
          const arb = await this.evaluateArbitrarge(exchanges[i], exchanges[j], symbol, size);
          if (arb && arb.netProfit >= profitThreshold) {
            console.log(chalk.whiteBright(`[ArbitrationScanner]🎯 Arbitrage opportunity found! Net Profit: ${chalk.yellowBright(arb.netProfit)}\n`));
            logger.info(`[ArbitrationScanner]🎯 Arbitrage opportunity found! Net Profit: ${arb.netProfit}`)
            opportunity.push(arb);
            const response = {size:size, symbol:symbol, firstExchange:exchanges[i].name,secondExchange:exchanges[j].name, netProfit:arb.netProfit, roi:arb.roi,cost:arb.cost,proceeds:arb.proceeds}
            this.trade === 'manual' ?  await this.showAlerts?.(chatId,response) : this.ShowAlertsWithAutoTrades?.(chatId,response);
          }
        }
      }
      logger.info("==================================================================================================n")
    }

    //console.log(chalk.whiteBright(`[ArbitrationScanner] Total opportunities found: ${chalk.yellowBright(opportunity.length)}`));
    logger.info(`[ArbitrationScanner] Total opportunities found: ${opportunity.length}`)
    opportunityToReturn = opportunity;
    // With WebSocket orderbooks, we can scan much faster (was 5000ms with REST)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!this.scannerSignal.active) break;
    }
    // console.log("✅ Scanner stopped gracefully.");
    return opportunityToReturn;
  }

  async arbitrargeExecution(op: ArbOpportunity) {
    //get orderbooks again at the time of execution

    //console.log(`[arbitrargeExecution] Executing arbitrage: Buy ${op.size} ${op.symbol} on ${op.buyExchange.name}, Sell on ${op.sellExchange.name}`);
    logger.info(`[arbitrargeExecution] Executing arbitrage: Buy ${op.size} ${op.symbol} on ${op.buyExchange.name}, Sell on ${op.sellExchange.name}`)
    try {
      const [buyRes, sellRes] = await Promise.all([
        op.buyExchange.marketBuy(op.symbol, op.size),
        op.sellExchange.marketSell(op.symbol, op.size),
      ]);

      console.log("[arbitrargeExecution] Buy Result:", buyRes);
      console.log("[arbitrargeExecution] Sell Result:", sellRes);
      //logger.info("[arbitrargeExecution] Buy Result:", buyRes)
      //logger.info("[arbitrargeExecution] Sell Result:", sellRes)
      const sequenceId = `direct_${Date.now()}`
      const saveBuyTx = await this.transactions?.saveTransaction({
          symbol: op.symbol,
          type: "direct",
          sequenceId: sequenceId,
          leg: 1,
          side: "BUY",
          status: buyRes?.status,   
          timestamp: buyRes?.time,
          price:buyRes?.price,
          quantity:op.size,
          responseMsg: buyRes?.msg,
          errorMsg:buyRes?.msg,
          orderId:buyRes?.orderId,
          exchange:op.buyExchange.name,
          assetGiven:'USDT',
          assetReceived:op.symbol.slice(0,3),
      })
      //console.log('Direct arbitrage first transaction buy: ', saveBuyTx);
      logger.info('Direct arbitrage first transaction buy: ', saveBuyTx)

      const saveSellTx = await this.transactions?.saveTransaction({
          symbol: op.symbol,
          type: "direct",
          sequenceId: sequenceId,
          leg: 2,
          side: "SELL",
          status: sellRes?.status,
          timestamp: sellRes?.time,
          price:sellRes?.price,
          quantity:op.size,
          responseMsg: sellRes?.msg,
          errorMsg:sellRes?.msg,
          orderId:sellRes?.orderId,
          exchange:op.sellExchange.name,
          assetGiven:op.symbol.slice(0,3),
          assetReceived:'USDT',
      })
      console.log('Direct arbitrage first transaction buy: ', saveBuyTx);
      console.log('Direct arbitrage second transaction sell: ', saveSellTx);
      logger.info('Direct arbitrage first transaction buy: ', JSON.stringify(saveBuyTx,null,2));
      logger.info('Direct arbitrage second transaction sell: ', JSON.stringify(saveSellTx,null,2))
      return { buyRes, sellRes, saveBuyTx, saveSellTx };
    } catch (err) {
      //console.error("[arbitrargeExecution] Error executing arbitrage:", err);
      logger.error("[arbitrargeExecution] Error executing arbitrage:", err)
      throw err;
    }
  }
}

//export const arbitration = new Arbitration();
