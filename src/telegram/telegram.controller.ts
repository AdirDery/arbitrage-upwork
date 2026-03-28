import { TelegramBot } from "typescript-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();
import { TelegramService } from "./telegram.service";
import { ConfigService } from "./config.service";
import { Alerts } from "./triangularArbitrageAlerts.service";
import { DirectArbitrageAlerts } from "./directArbitrageAlerts.service";
import { TriangularArbitrage } from "../arbitrage/triangularArbitrage.service";
import { Arbitration } from "../arbitrage/directArbitrage.service";
import { allExchanges } from "../paths/symbols";
import { ArbOpportunity } from "../arbitrage/arbitrage.types";
import { ExchangeAdapter } from "../arbitrage/arbitrage.types";
import { BinanceAdapter, BingXAdapter, BybitAdapter, MexcAdapter, OkxAdapter } from "../adapters";
import { Transactions } from "../transactions/transaction.service";
import { Config, UserPreferences } from "../config/config.model";

export class TelegramController {
  private service: TelegramService;
  private configService: ConfigService;
  private alertService: Alerts;
  private triangularArb: TriangularArbitrage;
  private directArb: Arbitration;
  private directArbAlerts: DirectArbitrageAlerts;
  private allExchanges: Record<string, ExchangeAdapter>;
  private transactions: Transactions;
  



  constructor(private bot: TelegramBot) {
    this.service = new TelegramService();
    this.configService = new ConfigService(bot);
    this.alertService = new Alerts(bot);
    this.directArbAlerts = new DirectArbitrageAlerts(bot);
    this.transactions = new Transactions(this.directArbAlerts.showTransactionHistory.bind(this.directArbAlerts));
    this.triangularArb = new TriangularArbitrage(bot,
      this.transactions,
      this.alertService.showAlerts.bind(this.alertService),
      this.alertService.showAlertsAutoTrade.bind(this.alertService),
    );
    this.directArb = new Arbitration(bot,
      this.transactions,
      this.directArbAlerts.showAlerts.bind(this.directArbAlerts),
      this.directArbAlerts.ShowAlertsWithAutoTrades.bind(this.directArbAlerts)
    )
    this.registerHandlers();
    // this.allExchanges = {
    //   Binance: new BinanceAdapter(),
    //   Bingx: new BingXAdapter(),
    //   Mexc: new MexcAdapter(),
    //   Bybit: new BybitAdapter(),
    //   Okx: new OkxAdapter(),
    // };
    this.allExchanges = allExchanges;

   this.setCommands()
}


  private async setCommands(){
     try {
     await  this.bot.setMyCommands({
      commands: [
      { command: 'start', description: 'Start the arbitrage bot' },
      //{ command: 'binance_quote', description: 'Get latest Binance prices' },
      //{ command: 'bybit_quote', description: 'Get latest Bybit prices' },
      { command: 'config', description: 'Configure your bot settings' },
      { command: 'triangular_alerts', description: 'Get triangular arbitrage alerts' },
      { command: 'direct_alerts', description: 'Get direct arbitrage alerts' },
      {command: 'transaction_history', description:'Get transaction history.'}
    ]
  }); 
  console.log(`Telegram commands set successfully.`);
    } catch (error) {
      console.error(`Error occured while setting telegram commands: ${error}`)
    }
  }

  private async registerHandlers() {    
    this.bot.on("message", async (msg) => {
      try {
         const chatId = msg.chat.id;
      const messageText = msg.text;
      console.log(chatId, messageText);

      if (messageText === "/start") {
          await this.bot.sendMessage({
            chat_id: chatId,
            text: "Welcome to Arbitrarge bot.",
        });
      }

      if (messageText === "/config") {
        // this.configService.selectCurrencies(chatId);
        //this.configService.selectCurrencies(chatId);
        await this.configService.selectExchangeCurrency(chatId);
      }

      if(messageText === "/triangular_alerts"){

        await this.alertService.selectTradeType(chatId);

        //await this.alertService.opportunityAlerts(chatId);
      }

      if(messageText === '/direct_alerts'){
        await this.directArbAlerts.selectTradeType(chatId);



        //await this.directArbAlerts.opportunityAlerts(chatId);
      }

      if(messageText === "/transaction_history"){
        await this.directArbAlerts.transactionHistory(chatId)
      }
   
      } catch (error) {
        console.error(`[Telegram Controller] Error occured while initialising messageText commands: ${error}`);
      }
     
      /*
      if (messageText === "/binance-quote") {
        const quote = await this.service.fetchBinancePrices();
        try {
          console.log(quote);
          await this.bot.sendMessage({
            chat_id: chatId,
            text: quote,
          });
        } catch (err) {
          console.error("Failed to send message to Telegram:", err);
        }
      }*/
     /*

      if (messageText === "/bybit-quote") {
        const quote = await this.service.fetchBybitPrices();
        try {
          console.log(quote);
          await this.bot.sendMessage({
            chat_id: chatId,
            text: quote,
          });
        } catch (err) {
          console.error("Failed to send message to Telegram:", err);
        }
      }
        */
    });


    
      this.bot.on("callback_query",async (query)=>{
      const chatId = query?.from?.id;
      const data = query.data;
      if(!data) return;
      //select currency exchange size slippage
      try {
        if(data.startsWith("select_currency")){
        console.log(data);
        await this.configService.selectCurrencies(chatId)
      }
      else if(data.startsWith("select_exchange")){
        console.log(data);
        await this.configService.selectExchanges(chatId)
      }
      else if(data.startsWith("select_direct_arb_size")){
        console.log(data);
        await this.configService.setDirectArbSize(chatId)
      }
      else if(data.startsWith("select_triangular_arb_size")){
        await this.configService.setTriangularArbSize(chatId);
      }
      else if(data.startsWith("select_slippage_threshold")){
        await this.configService.setSlippageTolerance(chatId);
      }
      else if(data.startsWith("select_profit_threshold")){
        await this.configService.setProfitThreshold(chatId);
      }

      //toggle selections

      else if(data.startsWith("symbol_")){
        const symbol = data.replace("symbol_", "");
        console.log(data);
        await this.configService.toggleCurrencySymbol(symbol)
      }

      else if(data.startsWith("exchange_")){
        const currency = data.replace("exchange_", "");
        console.log(data);
        await this.configService.toggleExchanges(currency)
      }

      //save selections
      else  if(data.startsWith("save_currency")){
      let user = await UserPreferences.findOne();
      let symbols = user?.selectedSymbols.join(", ") || '';

          await this.bot.sendMessage({
            chat_id: chatId,
            text: `*You have selected:*\n${symbols.replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1')}`,
            parse_mode:'MarkdownV2'
          });
        }

      else if(data.startsWith("save_exchanges")){
      let user = await UserPreferences.findOne();
      let exchanges = user?.selectedExchanges.join(", ") || '';
      console.log(`exchanges: `, exchanges);
          await this.bot.sendMessage({
            chat_id: chatId,
            text: `*You have selected:*\n${exchanges.replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1')}`,
            parse_mode:'MarkdownV2'
          });
      }
      
      //opportunity alerts

      else if (data.startsWith("cex_")) {
        await this.configService.handleCurrencySelection(query);
      }
      

      else if(data.startsWith("triangular_manual_trade")){
        // await this.triangularArb.startScanner();
        // await this.triangularArb.findOpportunity(chatId);
        await this.alertService.opportunityAlerts(chatId);
      }
      else if(data.startsWith("triangular_auto_trade")){
        await this.alertService.opportunityAlertsAutoTrade(chatId);
      }
      else if(data.startsWith("profit_")){  
        //triangular arbitrage manual trade
        this.triangularArb.trade = 'manual'
        await this.triangularArb.startScanner();
        await this.triangularArb.findOpportunity(chatId);
      }
      else if(data.startsWith("auto_profit_alerts")){
        console.log('data.startsWith("auto_profit_alerts")')
        //triangular arbitrage auto trade
        this.triangularArb.trade = 'auto'
        await this.triangularArb.startScanner();
        await this.triangularArb.findOpportunity(chatId);
      }
      else if(data.startsWith("stop_triangular_alerts")){
      try {
        console.log("🛑 Stopping triangular arbitrage alerts");
        await this.triangularArb.stopScanner(); 
        await this.bot.sendMessage({
        chat_id: chatId,
        text: "🛑 Triangular Arbitrage alerts will be stopped",
        parse_mode: "MarkdownV2",
      }); 
        } catch (error) {
          console.error(`Error while stopping triangular arbitrage: `, error);  
        }      
      }


      //trade execution

      } catch (error) {
        console.error("❌ Error handling callback query:", data, error);
      }

    })

    
    this.bot.on('callback_query', async(query)=>{
      try {
      const data = query.data;
      const chatId = query?.from?.id;
      if(!data) return;
      if(data.startsWith('direct_manual_trade')){
        await this.directArbAlerts.opportunityAlerts(chatId)
      }
      else if(data.startsWith("direct_auto_trade")){
        await this.directArbAlerts.opprtunityAlertsAutoTrade(chatId)
      }
      else if(data.startsWith("direct_profit_")){
      const user = await UserPreferences.findOne();
      const selectedExchangesName = user?.selectedExchanges || [];
      const selectedExchanges = selectedExchangesName.map(exchange => this.allExchanges[exchange])
      const config = await Config.findOne();
      const directArbSize = config?.directArbSize;
      const profitThreshold = config?.profitThreshold;
      console.log("selected exchanges----------->",selectedExchanges);
        await this.directArb.startScanner();
        this.directArb.trade = 'manual';
        await this.directArb.ArbitrationScanner(selectedExchanges, Number(directArbSize),Number(profitThreshold), chatId);
      }
      else if(data.startsWith("auto_direct_profit_alerts")){
      const user = await UserPreferences.findOne();
      const selectedExchangesName = user?.selectedExchanges || [];
      const selectedExchanges = selectedExchangesName.map(exchange => this.allExchanges[exchange])
      const config = await Config.findOne();
      const directArbSize = config?.directArbSize;
      const profitThreshold = config?.profitThreshold;
      console.log("selected exchanges----------->",selectedExchanges);
        await this.directArb.startScanner();
        this.directArb.trade = 'auto';
        await this.directArb.ArbitrationScanner(selectedExchanges, Number(directArbSize),Number(profitThreshold), chatId);
      }
      else if(data.startsWith("stop_direct_profit_alerts") || data.startsWith("auto_stop_direct_profit_alerts")){
        console.log("🛑 Stopping direct arbitrage alerts");
        await this.directArb.stopScanner(); 
        await this.bot.sendMessage({
        chat_id: chatId,
        text: "🛑 Direct Arbitrage alerts will be stopped",
        parse_mode: "MarkdownV2",
      }); 
    // }else if(data.startsWith("auto_stop_direct_profit_alerts")){
    //   console.log("🛑 Stopping direct arbitrage alerts, auto trade");
    //     await this.directArb.stopScanner(); 
    //     await this.bot.sendMessage({
    //     chat_id: chatId,
    //     text: "🛑 Direct Arbitrage alerts will be stopped, auto trade",
    //     parse_mode: "MarkdownV2",
    //   }); 
    // }
    }
    } catch (error) {
      console.error(`[Telegram Controller] Error while stopping direct arbitrage: `, error);  
    }
  })


    this.bot.on("callback_query", async(query)=>{
      try {
      const chatId = query?.from?.id;
      const data = query.data;
      if(!data) return
      if(data.startsWith('direct_trade|')){
        console.log("==================Trade Execution clicked======================")
        const tradeId = data.split('|')[1];
        const tradeParams = this.directArbAlerts.tempTrades.get(tradeId);
        console.log(tradeParams);

        const params:ArbOpportunity = {
          buyExchange: this.allExchanges[tradeParams?.firstExchange],
          sellExchange: this.allExchanges[tradeParams?.secondExchange],
          symbol: tradeParams.symbol,
          size: tradeParams.size,
          netProfit: tradeParams.netProfit,
          roi: tradeParams.roi,
          cost: tradeParams.cost,
          proceeds: tradeParams.proceeds,          
        }

      // await this.directArb.arbitrargeExecution(params);
      const {buyRes, sellRes, saveBuyTx, saveSellTx} = await this.directArb.arbitrargeExecution(params);
      console.log(`buyRes after telegram trade: ${JSON.stringify(saveBuyTx, null, 2)}`)
      console.log(`sellRes after telegram trade: ${JSON.stringify(saveSellTx, null, 2)}`)

      const tradeTelegramMsg = `⚡ *Direct Trade Order Placed*
      🆔 *Tx sequenceId:* \`${saveBuyTx?.sequenceId}\`      
      ⚪ *BUY ORDER*
      └ *Symbol:* \`${saveBuyTx?.symbol}\`
      └ *Exchange:* ${saveBuyTx?.exchange}
      └ *Asset Given:* ${saveBuyTx?.assetGiven}
      └ *Asset Received:* ${saveBuyTx?.assetReceived}
      └ *Response:* \`${saveBuyTx?.responseMsg}\`

       *SELL ORDER*
      └ *Symbol:* \`${saveSellTx?.symbol}\`
      └ *Exchange:* ${saveSellTx?.exchange}
      └ *Asset Given:* ${saveSellTx?.assetGiven}
      └ *Asset Received:* ${saveSellTx?.assetReceived}
      └ *Response:* \`${saveSellTx?.responseMsg}\`

      💰 *Trade Execution Completed*
      `
      this.bot.sendMessage({
        chat_id:chatId,
        text:tradeTelegramMsg,
        parse_mode:'MarkdownV2'
      })
      } 
      } catch (error) {
        console.error(`[Telegram Controller] Error occured while direct arbitrage execution: ${error}`)  
      }
    })

    this.bot.on("callback_query",async(query)=>{
      const chatId = query?.from?.id;
      const data = query.data;
      if(!data) return;
      if(data.startsWith('triangular_trade|')){
        try {
          console.log("==================Triangular Trade Execution clicked======================")
          const tradeId = data.split(`|`)[1];
          const tradeParams = this.alertService.tempTrades.get(tradeId);
          console.log(tradeParams);
          const exchanges = [this.allExchanges[tradeParams?.firstExchange], this.allExchanges[tradeParams?.secondExchange], this.allExchanges[tradeParams?.thirdExchange]];
          const amounts = [tradeParams?.initialQuoteNumber, tradeParams?.baseAfterFirstSim, tradeParams?.receivedQuoteAfterSecondSim];
          const tradePairs = [tradeParams?.firstTradepair, tradeParams?.secondTradepair, tradeParams?.thirdTradepair];
         // await this.triangularArb.executeProfitableSimulation(exchanges, amounts, tradePairs);  
          const {firstTradeOrder, secondTradeOrder, thirdTradeOrder, saveBuyTx, saveFirstSellTx, saveSecondSellTx } = await this.triangularArb.executeProfitableSimulation(exchanges, amounts, tradePairs);  

          const tradeTelegramMsg = `⚡ *Triangular Trade Order Placed*
          🆔 *Tx sequenceId:* \`${saveBuyTx?.sequenceId}\`      
          *BUY ORDER*
          └ *Symbol:* \`${saveBuyTx?.symbol}\`
          └ *Exchange:* ${saveBuyTx?.exchange}
          └ *Asset Given:* ${saveBuyTx?.assetGiven}
          └ *Asset Received:* ${saveBuyTx?.assetReceived}
          └ *Response:* \`${saveBuyTx?.responseMsg}\`

          *SELL ORDER*
          └ *Symbol:* \`${saveFirstSellTx?.symbol}\`
          └ *Exchange:* ${saveFirstSellTx?.exchange}
          └ *Asset Given:* ${saveFirstSellTx?.assetGiven}
          └ *Asset Received:* ${saveFirstSellTx?.assetReceived}
          └ *Response:* \`${saveFirstSellTx?.responseMsg}\`

          *SELL ORDER*
          └ *Symbol:* \`${saveSecondSellTx?.symbol}\`
          └ *Exchange:* ${saveSecondSellTx?.exchange}
          └ *Asset Given:* ${saveSecondSellTx?.assetGiven}
          └ *Asset Received:* ${saveSecondSellTx?.assetReceived}
          └ *Response:* \`${saveSecondSellTx?.responseMsg}\`

          💰 *Trade Execution Completed*
        `
          this.bot.sendMessage({
            chat_id:chatId,
            text:tradeTelegramMsg,
            parse_mode:'MarkdownV2'
          })
        } catch (error) {
          console.error(`[Telegram controller] Error occured while executing triangular profitable simulation: ${error}`);
        }
        
      }
    })

  this.bot.on("callback_query", async(query)=>{
      const chatId = query?.from?.id;
      const data = query.data;
      if(!data) return 
      if(data.startsWith('transaction_')){
        try {
            await this.transactions.getTransactionHistory(chatId);          
        } catch (error) {
          console.error(`[Telegram controller] Error occured while fetching transaction history: ${error}`);
        }
      }  
    }
  )
  }
}
