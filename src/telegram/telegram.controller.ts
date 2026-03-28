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
import { PaperTradingEngine } from "../paper/PaperTradingEngine";
import { DirectArbitrageStrategy, DirectArbConfig } from "../strategy/implementations/DirectArbitrageStrategy";
import { EvolutionEngine } from "../evolution/EvolutionEngine";
import { ClaudeAnalysis } from "../ai/ClaudeAnalysis";
import { marketRegimeDetector } from "../ai/MarketRegimeDetector";

export class TelegramController {
  private service: TelegramService;
  private configService: ConfigService;
  private alertService: Alerts;
  private triangularArb: TriangularArbitrage;
  private directArb: Arbitration;
  private directArbAlerts: DirectArbitrageAlerts;
  private allExchanges: Record<string, ExchangeAdapter>;
  private transactions: Transactions;
  private paperEngine: PaperTradingEngine | null = null;
  private evolutionEngine: EvolutionEngine | null = null;
  private claudeAnalysis: ClaudeAnalysis;
  



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
    this.claudeAnalysis = new ClaudeAnalysis();
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
      { command: 'transaction_history', description: 'Get transaction history.' },
      { command: 'paper_start', description: 'Start paper trading simulation' },
      { command: 'paper_stop', description: 'Stop paper trading' },
      { command: 'paper_status', description: 'Paper trading P&L and balances' },
      { command: 'paper_reset', description: 'Reset paper trading balances' },
      { command: 'evo_start', description: 'Start multi-brain evolution' },
      { command: 'evo_stop', description: 'Stop evolution and show results' },
      { command: 'evo_status', description: 'Evolution status and top brains' },
      { command: 'ai_report', description: 'AI daily analysis report' },
      { command: 'ai_regime', description: 'Current market regime' },
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

      // ─── Paper Trading Commands ───
      if(messageText === "/paper_start"){
        await this.handlePaperStart(chatId);
      }
      if(messageText === "/paper_stop"){
        await this.handlePaperStop(chatId);
      }
      if(messageText === "/paper_status"){
        await this.handlePaperStatus(chatId);
      }
      if(messageText === "/paper_reset"){
        await this.handlePaperReset(chatId);
      }

      // ─── Evolution Commands ───
      if(messageText === "/evo_start"){
        await this.handleEvoStart(chatId);
      }
      if(messageText === "/evo_stop"){
        await this.handleEvoStop(chatId);
      }
      if(messageText === "/evo_status"){
        await this.handleEvoStatus(chatId);
      }

      // ─── AI Commands ───
      if(messageText === "/ai_report"){
        await this.handleAiReport(chatId);
      }
      if(messageText === "/ai_regime"){
        await this.handleAiRegime(chatId);
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

  // ─── Paper Trading Handlers ────────────────────────────────

  private async handlePaperStart(chatId: number) {
    try {
      if (this.paperEngine) {
        await this.bot.sendMessage({ chat_id: chatId, text: "Paper trading is already running. Use /paper_stop first." });
        return;
      }

      // Create paper engine with $10K virtual capital per exchange
      const initialCapital: Record<string, Record<string, number>> = {};
      for (const name of Object.keys(this.allExchanges)) {
        initialCapital[name] = { USDT: 10000 };
      }

      this.paperEngine = new PaperTradingEngine(this.allExchanges, { initialCapital });

      // Create a direct arb strategy using paper adapters
      const user = await UserPreferences.findOne();
      const selectedSymbols = user?.selectedSymbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
      const selectedExchangeNames = user?.selectedExchanges || Object.keys(this.allExchanges);
      const config = await Config.findOne();

      const paperAdapters = this.paperEngine.getAllAdapters();
      const exchanges = selectedExchangeNames
        .map(name => paperAdapters[name])
        .filter(Boolean) as any[];

      const strategy = new DirectArbitrageStrategy("paper_direct");
      await strategy.initialize({
        exchanges,
        symbols: selectedSymbols,
        tradeSize: config?.directArbSize || 0.5,
        profitThreshold: config?.profitThreshold || 0.5,
      });

      // Start scanning
      this.paperEngine.startStrategy(strategy, 2000);

      await this.bot.sendMessage({
        chat_id: chatId,
        text: `📊 *Paper Trading Started\\!*\n\n💰 Virtual Capital: \\$10,000 per exchange\n🔄 Scanning every 2 seconds\n📈 Strategy: Direct Arbitrage\n\nUse /paper\\_status to check P\\&L\nUse /paper\\_stop to stop`,
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      console.error(`[Telegram Controller] Paper start error:`, error);
      await this.bot.sendMessage({ chat_id: chatId, text: "Error starting paper trading." });
    }
  }

  private async handlePaperStop(chatId: number) {
    if (!this.paperEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "Paper trading is not running." });
      return;
    }

    this.paperEngine.stop();
    await this.paperEngine.savePerformanceSnapshot();

    const results = this.paperEngine.getResults();
    const pnlEmoji = results.totalPnL >= 0 ? "📈" : "📉";

    await this.bot.sendMessage({
      chat_id: chatId,
      text: `🛑 *Paper Trading Stopped*\n\n${pnlEmoji} Total P&L: $${results.totalPnL.toFixed(4)}\n📊 Trades: ${results.totalTrades}\n✅ Win Rate: ${(results.winRate * 100).toFixed(1)}%`,
      parse_mode: "Markdown",
    });

    this.paperEngine = null;
  }

  private async handlePaperStatus(chatId: number) {
    if (!this.paperEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "Paper trading is not running. Use /paper_start" });
      return;
    }

    const results = this.paperEngine.getResults();
    const balances = results.balances;
    const pnlEmoji = results.totalPnL >= 0 ? "📈" : "📉";

    let balanceText = "";
    for (const [exchange, assets] of Object.entries(balances)) {
      const usdtBal = assets["USDT"] || 0;
      balanceText += `  ${exchange}: $${usdtBal.toFixed(2)} USDT\n`;
    }

    // Show last 5 trades
    const recentTrades = results.trades.slice(-5).map((t, i) => {
      const icon = t.profit > 0 ? "✅" : "❌";
      return `  ${icon} $${t.profit.toFixed(4)} | ${t.legs.map(l => l.exchange).join("→")}`;
    }).join("\n");

    await this.bot.sendMessage({
      chat_id: chatId,
      text: `📊 *Paper Trading Status*\n\n${pnlEmoji} Total P&L: $${results.totalPnL.toFixed(4)}\n📊 Total Trades: ${results.totalTrades}\n✅ Win Rate: ${(results.winRate * 100).toFixed(1)}%\n\n💰 *Balances:*\n${balanceText}\n📝 *Recent Trades:*\n${recentTrades || "  No trades yet"}`,
      parse_mode: "Markdown",
    });
  }

  private async handlePaperReset(chatId: number) {
    if (this.paperEngine) {
      this.paperEngine.stop();
      await this.paperEngine.reset();
      this.paperEngine = null;
    }

    await this.bot.sendMessage({
      chat_id: chatId,
      text: "🔄 Paper trading reset. Virtual balances restored to initial capital.\nUse /paper_start to begin again.",
    });
  }

  // ─── Evolution Handlers ────────────────────────────────────

  private async handleEvoStart(chatId: number) {
    try {
      if (this.evolutionEngine) {
        await this.bot.sendMessage({ chat_id: chatId, text: "Evolution is already running. Use /evo_stop first." });
        return;
      }

      const user = await UserPreferences.findOne();
      const symbols = user?.selectedSymbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

      this.evolutionEngine = new EvolutionEngine(this.allExchanges, symbols);
      await this.evolutionEngine.start({
        populationSize: 10,
        eliteCount: 2,
        mutationRate: 0.2,
        crossoverRate: 0.7,
        tournamentSize: 3,
        strategyType: "direct",
      });

      await this.bot.sendMessage({
        chat_id: chatId,
        text: `🧬 *Evolution Engine Started\\!*\n\n🧠 Population: 10 brains\n📊 Strategy: Direct Arbitrage\n⏱ Eval Period: 24 hours\n🏆 Elite: Top 2 survive each generation\n🔀 Mutation Rate: 20%\n\nUse /evo\\_status to monitor\nUse /evo\\_stop to stop`,
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      console.error(`[Telegram Controller] Evolution start error:`, error);
      await this.bot.sendMessage({ chat_id: chatId, text: "Error starting evolution engine." });
    }
  }

  private async handleEvoStop(chatId: number) {
    if (!this.evolutionEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "Evolution is not running." });
      return;
    }

    const report = await this.evolutionEngine.stop();
    const best = this.evolutionEngine.getBestBrainChromosome();

    let msg = "🛑 *Evolution Stopped*\n\n";

    if (report) {
      msg += `📊 Generation: ${report.generation}\n`;
      msg += `🏆 Best Fitness: ${report.bestFitness.toFixed(4)}\n`;
      msg += `📈 Avg Fitness: ${report.avgFitness.toFixed(4)}\n\n`;

      msg += `*Top 5 Brains:*\n`;
      for (const s of report.brainSummaries.slice(0, 5)) {
        const icon = s.return >= 0 ? "🟢" : "🔴";
        msg += `${icon} ${s.id.slice(0, 12)}... | Fit: ${s.fitness.toFixed(3)} | $${s.return.toFixed(2)} | ${s.trades} trades\n`;
      }
    }

    if (best) {
      msg += `\n🧬 *Best Brain Config:*\n`;
      for (const gene of best.chromosome.genes) {
        msg += `  ${gene.name}: ${gene.value}\n`;
      }
    }

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "Markdown" });
    this.evolutionEngine = null;
  }

  private async handleEvoStatus(chatId: number) {
    if (!this.evolutionEngine) {
      await this.bot.sendMessage({ chat_id: chatId, text: "Evolution is not running. Use /evo_start" });
      return;
    }

    const status = this.evolutionEngine.getStatus();

    let msg = `🧬 *Evolution Status*\n\n`;
    msg += `🔄 Running: ${status.running ? "Yes" : "No"}\n`;
    msg += `📊 Generation: ${status.generation}\n`;
    msg += `🧠 Population: ${status.populationSize} brains\n\n`;

    if (status.topBrains.length > 0) {
      msg += `*Top 5 Brains:*\n`;
      for (const b of status.topBrains) {
        msg += `  🧠 ${b.id.slice(0, 15)}... | Fitness: ${b.fitness.toFixed(4)} | Gen: ${b.generation}\n`;
      }
    }

    if (status.recentReports.length > 0) {
      const latest = status.recentReports[status.recentReports.length - 1];
      msg += `\n*Latest Generation Report:*\n`;
      msg += `  Best: ${latest.bestFitness.toFixed(4)} | Avg: ${latest.avgFitness.toFixed(4)}\n`;
    }

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "Markdown" });
  }

  // ─── AI Handlers ───────────────────────────────────────────

  private async handleAiReport(chatId: number) {
    await this.bot.sendMessage({ chat_id: chatId, text: "🤖 Generating AI analysis report..." });

    try {
      const report = await this.claudeAnalysis.generateDailyReport();

      // Split long messages (Telegram limit: 4096 chars)
      const chunks = this.splitMessage(report, 4000);
      for (const chunk of chunks) {
        await this.bot.sendMessage({ chat_id: chatId, text: `🤖 *AI Analysis*\n\n${chunk}`, parse_mode: "Markdown" });
      }
    } catch (error) {
      await this.bot.sendMessage({ chat_id: chatId, text: "Error generating AI report. Check CLAUDE_API_KEY in .env" });
    }
  }

  private async handleAiRegime(chatId: number) {
    // Record latest snapshot
    marketRegimeDetector.recordSnapshot();

    const analysis = marketRegimeDetector.detectRegime();
    const modifiers = marketRegimeDetector.getParameterModifiers(analysis.regime);

    const regimeEmoji: Record<string, string> = {
      calm: "😌", volatile: "⚡", trending: "📈", choppy: "🌊"
    };

    const msg = `${regimeEmoji[analysis.regime] || "📊"} *Market Regime: ${analysis.regime.toUpperCase()}*

📊 Confidence: ${(analysis.confidence * 100).toFixed(0)}%
📉 Volatility: ${analysis.volatility.toFixed(1)}% (annualized)
📏 Avg Spread: ${analysis.spreadMean.toFixed(4)}%
📐 Spread StdDev: ${analysis.spreadStdDev.toFixed(4)}%

💡 *Recommendation:*
${analysis.recommendation}

⚙️ *Parameter Adjustments:*
  Profit Threshold: x${modifiers.profitThresholdMultiplier}
  Trade Size: x${modifiers.tradeSizeMultiplier}
  Scan Speed: x${modifiers.scanIntervalMultiplier}`;

    await this.bot.sendMessage({ chat_id: chatId, text: msg, parse_mode: "Markdown" });
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    return chunks;
  }
}
