import { ExchangeAdapter } from "./arbitrage.types";
import { Orderbook, orderbookSide } from "../orderBooks/ordrbooks.types";
import { exchangeSymbols } from "../paths/symbols";
import { basePaths, generateCrossExchangePaths } from "../paths/paths";
import {
  BinanceAdapter,
  BingXAdapter,
  MexcAdapter,
  BybitAdapter,
  OkxAdapter
} from "../adapters";
import chalk from "chalk";
import { Alerts } from "../telegram/triangularArbitrageAlerts.service";
import { Transactions } from "../transactions/transaction.service";
import { Config } from "../config/config.model";
import logger from "../core/logger.service";


export class TriangularArbitrage {
  private allExchanges: Record<string, ExchangeAdapter>;
  private feasibleTradingPaths: {
    exchange: string;
    symbol: string;
    direction: string;
  }[][] = [];
  private scannerSignal = { active: true };
  public trade: 'auto' | 'manual' = 'manual';
  constructor(
    private bot: any,
    private transactions:Transactions,
    private showAlerts?: (chatId: string, response:any) => Promise<void>,
    private opportunityAlertsAutoTrade?: (chatId: string, response:any) => Promise<void>,
  ) {

    this.allExchanges = {
      Binance: new BinanceAdapter(),
      Bingx: new BingXAdapter(),
      Mexc: new MexcAdapter(),
      Bybit: new BybitAdapter(),
      Okx: new OkxAdapter(),
    };
  }

  private async isOrderbookEmpty(orderbook:{bids:[number,number][],asks:[number, number][]}){
    return (orderbook.asks.length === 0 || orderbook.bids.length === 0)
  } 

  async startScanner(){
    this.scannerSignal.active = true;
    console.log("🟢 Direct Arbitrage Scanner signal set to true — starting loop.");
  }

  async stopScanner() {
    this.scannerSignal.active = false;
    console.log("🛑 Direct Arbitrage Scanner signal set to false — stopping loop.");
  }

  async findOpportunity(chatId:any) {
    this.feasibleTradingPaths = await generateCrossExchangePaths(
      exchangeSymbols,
      basePaths
    );
    // console.log(this.feasibleTradingPaths);
    console.log(`Looking for opportunities in a triangular abitrarge across different exchanges`)
    while(this.scannerSignal.active){
    for (let i = 0; i < this.feasibleTradingPaths.length; i++) {
      console.log(`\n==============================`);

      //Getting trade exchanges
      const firstExchangeName = this.feasibleTradingPaths[i][0].exchange;
      const secondExchangeName = this.feasibleTradingPaths[i][1].exchange;
      const thirdExchangeName = this.feasibleTradingPaths[i][2].exchange;

      const firstExchange = this.allExchanges[firstExchangeName];
      const secondExchange = this.allExchanges[secondExchangeName];
      const thirdExchange = this.allExchanges[thirdExchangeName];

      console.log(chalk.whiteBright(`Exchanges involved in the trade: ${chalk.yellowBright(firstExchange.name)}, ${chalk.yellowBright(secondExchange.name)} , ${chalk.yellowBright(thirdExchange.name)}`));

      //getting trade symbols

      const firstTradeSymbol = this.feasibleTradingPaths[i][0].symbol;
      const secondTradeSymbol = this.feasibleTradingPaths[i][1].symbol;
      const thirdTradeSymbol = this.feasibleTradingPaths[i][2].symbol;
      console.log(chalk.whiteBright(`trade symbols involved in the trade: ${chalk.yellowBright(firstTradeSymbol)}, ${chalk.yellowBright(secondTradeSymbol)}, ${chalk.yellowBright(thirdTradeSymbol)}`));

      console.log(chalk.whiteBright(
        `🔍 Checking triangular arbitrage on: ${chalk.yellowBright(firstExchange.name)}, ${chalk.yellowBright(secondExchange.name)}, ${chalk.yellowBright(thirdExchange.name)}`
      ));
      console.log(
        `=============Finding Opportunity ${i + 1} =================\n`
      );

      // Step 1: Fetch all 3 orderbooks in parallel
      console.log("📥 Fetching orderbooks in parallel...");

      const [firstOrderbook, secondOrderbook, thirdOrderbook]: Orderbook[] = await Promise.all([
        firstExchange.getOrderbook(firstTradeSymbol),
        secondExchange.getOrderbook(secondTradeSymbol),
        thirdExchange.getOrderbook(thirdTradeSymbol)
      ]);

      if(await this.isOrderbookEmpty(firstOrderbook) || await this.isOrderbookEmpty(secondOrderbook) || await this.isOrderbookEmpty(thirdOrderbook)) continue;

      console.log(chalk.whiteBright(
        `[${chalk.yellowBright(firstExchange.name)}] ${chalk.yellowBright(firstTradeSymbol)} | Best Ask: ${chalk.yellowBright(firstOrderbook.asks[0][0])} | Best Bid: ${chalk.yellowBright(firstOrderbook.bids[0][0])}`
      ));
      console.log(chalk.whiteBright(
        `[${chalk.yellowBright(secondExchange.name)}] ${chalk.yellowBright(secondTradeSymbol)} | Best Ask: ${chalk.yellowBright(secondOrderbook.asks[0][0])} | Best Bid: ${chalk.yellowBright(secondOrderbook.bids[0][0])}`
      ));
      console.log(chalk.whiteBright(
        `[${chalk.yellowBright(thirdExchange.name)}] ${chalk.yellowBright(thirdTradeSymbol)} | Best Ask: ${chalk.yellowBright(thirdOrderbook.asks[0][0])} | Best Bid: ${chalk.yellowBright(thirdOrderbook.bids[0][0])}`
      ));

      // Step 2: Start with USDT
      const config = await Config.findOne();
      const triangularArbCapital = config?.triangularArbSize
      let capital = Number(triangularArbCapital); // Load from config later
      console.log(`\n💰 Starting Capital: ${capital} USDT`);

      // Trade 1:
      const firstTrade = capital / firstOrderbook.asks[0][0];
      console.log(chalk.whiteBright(`\n--- Trade 1️⃣ ${chalk.yellowBright(firstTradeSymbol)} ---`));
      console.log(chalk.whiteBright(`Ask Price (${chalk.yellowBright(firstTradeSymbol)}): ${chalk.yellowBright(firstOrderbook.asks[0][0])}`));
      console.log(chalk.whiteBright(`${chalk.yellowBright(firstTradeSymbol.slice(0,3))} Bought: ${chalk.yellowBright(firstTrade.toFixed(8))}\n`));
      // Market orders are always taker orders
      const firstTradeFee = await firstExchange.getFees();
      const firstTradeTakerFee = firstTradeFee.taker * firstTrade;
      const firstTradeAfterFee = firstTrade - firstTradeTakerFee;
      console.log(chalk.whiteBright(`Final ${firstTradeSymbol.slice(0,3)} bought after fee: ${firstTradeAfterFee.toFixed(8)}\n`));

      // Trade 2: 
      const secondTrade = firstTradeAfterFee * secondOrderbook.asks[0][0];
      console.log(chalk.whiteBright(`--- Trade 2️⃣ ${chalk.yellowBright(secondTradeSymbol.slice(0,3))} → ${chalk.yellowBright(secondTradeSymbol.slice(3,6))} ---`));
      console.log(chalk.whiteBright(`Ask Price ${chalk.yellowBright(secondTradeSymbol)}: ${chalk.yellowBright(secondOrderbook.asks[0][0])}`));
      console.log(chalk.whiteBright(`${chalk.yellowBright(secondTradeSymbol.slice(3,6))} Bought: ${chalk.yellowBright(secondTrade.toFixed(8))}\n`));
      const secondTradeFee = await secondExchange.getFees();
      const secondTradeTakerFee = secondTradeFee.taker * secondTrade;
      const tradeAfterFee_02 = secondTrade - secondTradeTakerFee;
      console.log(chalk.whiteBright(`Final ${chalk.yellowBright(secondTradeSymbol.slice(3,6))} bought after fee: ${chalk.yellowBright(tradeAfterFee_02.toFixed(8))}\n`));

      // Trade 3:
      console.log('tradeAfterFee_02:----->',tradeAfterFee_02, 'thirdOrderbook.bids[0][0]',thirdOrderbook.bids[0][0]);
      const thirdTrade = tradeAfterFee_02 * thirdOrderbook.bids[0][0];
      console.log(chalk.whiteBright(`--- Trade 3️⃣ ${chalk.yellowBright(thirdTradeSymbol.slice(0,3))} → USDT ---`));
      console.log(chalk.whiteBright(`Bid Price ${chalk.yellowBright(thirdTradeSymbol)}: ${chalk.yellowBright(thirdOrderbook.bids[0][0])}`));
      console.log(chalk.whiteBright(`Final USDT: ${chalk.yellowBright(thirdTrade.toFixed(8))}\n`));
      const thirdTradeFee = await thirdExchange.getFees();
      const thirdTradeTakerFee = thirdTradeFee.taker * thirdTrade;
      const tradeAfterFee_03 = thirdTrade - thirdTradeTakerFee;
      console.log(chalk.whiteBright(`Final ${chalk.yellowBright(thirdTradeSymbol.slice(3,6))} bought after fee: ${chalk.yellowBright(tradeAfterFee_03.toFixed(8))}\n`));
      const finalUsdt = tradeAfterFee_03;



      // Step 3: Profit Calculation
      const profit = finalUsdt - capital;
      console.log(chalk.whiteBright(`📊 Profit/Loss Calculation`));
      console.log(chalk.whiteBright(
        `Start: ${capital} USDT | Final: ${finalUsdt.toFixed(
          8
        )} USDT | Profit: ${profit.toFixed(8)} USDT\n`
      ));

      if (profit > 0) {
        console.log(chalk.greenBright.bold(`✅ PROFIT OPPORTUNITY! +${profit.toFixed(8)} USDT`));
        const config = await Config.findOne();
        const slippagePercent = config?.slippageTolerance;
        const minProfitThreshfold = config?.profitThreshold;
        logger.info(`[Triangular Arbitrage] min profit threshold: ${minProfitThreshfold}`)
        const opts = {
        minProfitThreshfold:Number(minProfitThreshfold),
        slippagePercent:Number(slippagePercent),
        maxRetires:2,
        unwindRetries:2 ,
        minAcceptProfitPercent:0.25
        }
        await this.triangularArbitrageExecution(Number(triangularArbCapital),[firstExchange,secondExchange,thirdExchange],[firstTradeSymbol,secondTradeSymbol,thirdTradeSymbol],opts,chatId);
      } else {
        console.log(chalk.redBright(
          `❌ No profit opportunity detected. Profit: ${profit.toFixed(8)} USDT`
        ));
      }
      console.log(`\n==========================================================================\n`);
      console.log("\n======================Triangular Abitrage Cycle completed=================\n")
      }
      // With WebSocket orderbooks, we can scan much faster (was 5000ms with REST)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if(!this.scannerSignal.active) break;
    }    
  }


  async simulateAgainstOrderbooks(book:Orderbook, side:'buy' | 'sell', amount:number, amountInQuote:boolean){
    //get order books
    const levels = side === 'buy'? book.asks : book.bids // asks: ascending order / bids: descending order
    
    let remaining = amount;
    let totalBase = 0;  // base assests accumulated(for buys)
    let totalQuote = 0; // base assets accumulated(for sells)
    let consumedBase = 0;
    let consumedQuote = 0;

    let lastPrice = levels[0][0];

    for(const [price, quantity] of  levels){
      if(amountInQuote){
        const levelCost = price * quantity; // buying base using quote currency: at price, can buy qty base costing price*qty quote  
        if(remaining >= levelCost){
          //means we can consume whole level
          totalBase += quantity;
          consumedQuote += levelCost;
          remaining -= levelCost;
          lastPrice = price;
        }else{
          const baseAtThisLevel = remaining / price;
          totalBase += baseAtThisLevel;
          consumedQuote += remaining;
          remaining = 0;
          lastPrice = price;
          break;
        }
      }else{
        // amount provided in base units(selling base to get quote)
        if(remaining >= quantity){
          totalQuote += price * quantity;
          consumedBase += quantity;
          remaining -= quantity;
          lastPrice = price;
        }else{
          totalQuote += price * remaining;
          consumedBase += remaining;
          remaining -= quantity;
          lastPrice = price;
          break;
        }
      }
      console.log(`remaining:---------> `, remaining);
      console.log(`totalBase:---------> `, totalBase);
      console.log(`totalQuote:--------> `, totalQuote);
      console.log(`consumedBase:------> `, consumedBase);
      console.log(`consumedQuote:-----> `, consumedQuote);
    }

    const filledBase = amountInQuote ? totalBase: consumedBase;
    const receivedQuote = amountInQuote ? consumedQuote : totalQuote;

    const effectivePrice = receivedQuote / (filledBase || 1) // quote per base

    const incomplete = remaining >= 1e-12;

    return {
      filledBase,
      receivedQuote,
      effectivePrice,
      incomplete,
      lastPrice
    }
    
  }

  async executeProfitableSimulation(exchanges:ExchangeAdapter[], amounts:number[], tradePairs:string[]):Promise<{
    firstTradeOrder: any;
    secondTradeOrder: any;
    thirdTradeOrder: any;
    saveBuyTx: any;
    saveFirstSellTx: any;
    saveSecondSellTx: any;
  }>{
    try {
      // Removed inner `await` — they defeat Promise.all parallelism
      const [firstTradeOrder, secondTradeOrder, thirdTradeOrder] = await Promise.all([
        exchanges[0].marketBuy(tradePairs[0], amounts[0]),
        exchanges[1].marketSell(tradePairs[1], amounts[1]),
        exchanges[2].marketSell(tradePairs[2], amounts[2])
      ])
      console.log('execute first trade order',firstTradeOrder);
      console.log('execute second trade order',secondTradeOrder);
      console.log('execute third trade order',thirdTradeOrder);
        const firstSymbol = tradePairs[0].slice(3,6);
        const secondSymbol = tradePairs[1].slice(0,3);
        const thirdSymbol = tradePairs[1].slice(3,6);
      const sequenceId = `direct_${Date.now()}`
      const saveBuyTx = await this.transactions.saveTransaction({
         symbol: tradePairs[2],
          type: "direct",
          sequenceId: sequenceId,
          leg: 1,
          side: "BUY",
          status: firstTradeOrder?.status,
          timestamp: firstTradeOrder?.time,
          price:firstTradeOrder?.price,
          quantity:amounts[0],
          responseMsg: firstTradeOrder?.msg,
          errorMsg:firstTradeOrder?.msg,
          orderId:firstTradeOrder?.orderId,
          exchange:exchanges[0].name,
          assetGiven:firstSymbol,
          assetReceived:secondSymbol
      })

      const saveFirstSellTx = await this.transactions.saveTransaction({
         symbol: tradePairs[1],
          type: "direct",
          sequenceId: sequenceId,
          leg: 2,
          side: "SELL",
          status: secondTradeOrder?.status,
          timestamp: secondTradeOrder?.time,
          price:secondTradeOrder?.price,
          quantity:amounts[1],
          responseMsg: secondTradeOrder?.msg,
          errorMsg:secondTradeOrder?.msg,
          orderId:secondTradeOrder?.orderId,
          exchange:exchanges[1].name,
          assetGiven:secondSymbol,
          assetReceived:thirdSymbol
      })

      const saveSecondSellTx = await this.transactions.saveTransaction({
         symbol: tradePairs[2],
          type: "direct",
          sequenceId: sequenceId,
          leg: 3,
          side: "SELL",
          status: thirdTradeOrder?.status,
          timestamp: thirdTradeOrder?.time,
          price:thirdTradeOrder?.price,
          quantity:amounts[2],
          responseMsg: thirdTradeOrder?.msg,
          errorMsg:thirdTradeOrder?.msg,
          orderId:thirdTradeOrder?.orderId,
          exchange:exchanges[2].name,
          assetGiven:thirdSymbol,
          assetReceived:firstSymbol
      })


      console.log('Triangular arbitrage first transaction buy: ', saveBuyTx);
      console.log('Triangular arbitrage second transaction sell: ', saveFirstSellTx);
      console.log('Triangular arbitrage third transaction sell: ', saveSecondSellTx);
      return { firstTradeOrder, secondTradeOrder, thirdTradeOrder, saveBuyTx, saveFirstSellTx, saveSecondSellTx };

    } catch (error) {
      console.error(`Error executing triangular arbitrage: `,error);
      throw error;      
    }
    /*
    const firstTradeOrder = await exchanges[0].marketBuy(tradePairs[0], amounts[0])
    console.log('execute first trade order',firstTradeOrder);
    const secondTradeOrder = await exchanges[1].marketSell(tradePairs[1], amounts[1]);
    console.log('execute second trade order',secondTradeOrder);
    const thirdTradeOrder = await exchanges[2].marketSell(tradePairs[2], amounts[2]);
    console.log('execute third trade order',thirdTradeOrder);
    */
  }


  
  async sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }


  async triangularArbitrageExecution(initialQuoteNumber:number,
    exchanges:ExchangeAdapter[], tradePairs:string[],
     opts:{
      minProfitThreshfold?:number;
      slippagePercent?:number;
      maxRetires?:number;
      unwindRetries?:number;
      minAcceptProfitPercent?:number;}={},
      chatId:any
    ){
      const minProfitThreshfold = opts.minProfitThreshfold ?? 0.5
      const slippagePercent = opts.slippagePercent ?? 0.25;
      const maxRetires = opts.maxRetires ?? 2;
      const unwindRetries = opts.unwindRetries ?? 2;


    //Fetch orderbooks again 

    try {
      console.log('Fetching fresh orderbooks for transaction execution: ')
      const[firstOrderbook, secondOrderbook, thirdOrderbook] = await Promise.all([
          exchanges[0].getOrderbook(tradePairs[0]),
          exchanges[1].getOrderbook(tradePairs[1]),
          exchanges[2].getOrderbook(tradePairs[2]),
      ])  

      // Simulate trade and calculate potential profit 
      console.log(`Simulate trade to calculate slippage and potential profit.....`)
      //First trade simulation
      const firstSim = await this.simulateAgainstOrderbooks(firstOrderbook,'buy', initialQuoteNumber, true)
      if((firstSim as any).error) throw new Error(`First trade simulation failed.`)
      console.log('firstSim----------------------------->', firstSim);
      
      const receivedQuoteFirstSim = firstSim?.receivedQuote;
      console.log('receivedQuoteFirstSim------>', receivedQuoteFirstSim);
      let baseAfterFirstSim = firstSim.filledBase;
      console.log(`baseAfterFirstSim:--------> `, baseAfterFirstSim)
      const firstTradeEffectivePrice = firstSim.effectivePrice;
      console.log(`firstTradeEffectivePrice------->`, firstTradeEffectivePrice);      
      // Slippage is already accounted for by simulateAgainstOrderbooks() walking the book.
      // Only apply exchange fees here.
      const fee1 = (await exchanges[0].getFees()).taker;
      baseAfterFirstSim = baseAfterFirstSim * (1 - fee1);
      console.log(`baseAfterFirstSim after fee----->`, baseAfterFirstSim);

     
      //Second trade simulation
      const secondSim = await this.simulateAgainstOrderbooks(secondOrderbook,'sell',baseAfterFirstSim, false);
      console.log('secondSim----------------------------->', secondSim);
      if((secondSim as any).error) throw new Error(`Second trade simulation failed.`);

      let receivedQuoteAfterSecondSim = secondSim.receivedQuote;
      console.log(`receivedQuoteAfterSecondSim:--------> `, receivedQuoteAfterSecondSim)
      const secondTradeEffectivePrice = secondSim.effectivePrice;
      console.log(`secondTradeEffectivePrice------->`,secondTradeEffectivePrice);
      // Fix: use exchanges[1] for second leg fees, not exchanges[2]
      // Slippage already accounted for by orderbook walk
      const fee2 = (await exchanges[1].getFees()).taker;
      console.log('fee2---------------->', fee2);
      receivedQuoteAfterSecondSim = receivedQuoteAfterSecondSim * (1 - fee2);
      console.log(`receivedQuoteAfterSecondSim after fee:-----> `, receivedQuoteAfterSecondSim);


      //third trade simulation
      const thirdSim = await this.simulateAgainstOrderbooks(thirdOrderbook, 'sell',receivedQuoteAfterSecondSim,false);
      console.log('thirdSim----------------------------->', thirdSim);
      if((thirdSim as any).error) throw new Error(`Third trade simulation failed`);
      let receivedQuoteAfterThirdSim = thirdSim.receivedQuote;
      console.log(`receivedQuoteAfterThirdSim:--------> `, receivedQuoteAfterThirdSim)
      // Slippage already accounted for by orderbook walk
      const fee3 = (await exchanges[2].getFees()).taker;
      console.log('fee3---------------->', fee3);
      receivedQuoteAfterThirdSim = receivedQuoteAfterThirdSim * (1 - fee3);
      console.log('receivedQuoteAfterThirdSim after fee:-------->', receivedQuoteAfterThirdSim);
      const expectedProfit = receivedQuoteAfterThirdSim - initialQuoteNumber;

      const config = await Config.findOne();
      const profitThreshold = config?.profitThreshold;
      if(expectedProfit > Number(profitThreshold)){
        console.log(`✅ Simulated Final Quote: `, receivedQuoteAfterThirdSim, `expected profit: `, expectedProfit);
        const firstSymbol = tradePairs[0].slice(3,6);
        const secondSymbol = tradePairs[0].slice(0,3);
        const thirdSymbol = tradePairs[1].slice(3,6);

       const response = {initialQuoteNumber:initialQuoteNumber, firstExchange:exchanges[0].name, secondExchange:exchanges[1].name,
        thirdExchange:exchanges[2].name, firstTradepair:tradePairs[0],secondTradepair:tradePairs[1], thirdTradepair:tradePairs[2],
        firstSim:firstSim, baseAfterFirstSim:baseAfterFirstSim.toFixed(4), receivedQuoteAfterSecondSim:receivedQuoteAfterSecondSim.toFixed(4), receivedQuoteAfterThirdSim:receivedQuoteAfterThirdSim.toFixed(4),
        expectedProfit:expectedProfit
      }

        this.trade === 'manual'? await this.showAlerts?.(chatId,response) : await this.opportunityAlertsAutoTrade?.(chatId,response);
      }else{
        console.log(`❌ Simulated Final Quote: `, receivedQuoteAfterThirdSim, `expected profit: `, expectedProfit);
      }

    if (expectedProfit < minProfitThreshfold) {
      console.log(`{ status: 'aborted', reason: 'profit too low', expectedProfit }`)
      return { status: 'aborted', reason: 'profit too low', expectedProfit };
    }


    //Execute the orders one by one
    //await this.executeProfitableSimulation(exchanges,[initialQuoteNumber,firstBaseafterSlippage, secondQuoteAfterSlippage], tradePairs)

    } catch (error) {
      console.log('Error during triangularArbitrageExecution', error);
    }

  }
}
