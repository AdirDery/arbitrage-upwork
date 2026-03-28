import { TelegramBot, InlineKeyboardMarkup } from "typescript-telegram-bot-api";
import { allExchanges } from "../paths/symbols";
import { ExchangeName } from "../paths/symbols";
import { TriangularArbitrage } from "../arbitrage/triangularArbitrage.service";
import { Transactions } from "../transactions/transaction.service";
import { DirectArbitrageAlerts } from "./directArbitrageAlerts.service";


export class Alerts{
    private bot:TelegramBot;
    public tempTrades: Map<string, any>;
    private triangularArb: TriangularArbitrage;
    private transactions: Transactions;
    private directArb: DirectArbitrageAlerts;
    
    constructor(bot:TelegramBot){
        this.bot = bot;
        this.tempTrades = new Map();
        this.directArb = new DirectArbitrageAlerts(bot);
        this.transactions = new Transactions(this.directArb.showTransactionHistory.bind(this));
        this.triangularArb = new TriangularArbitrage(bot, this.transactions)
    }

    async opportunityAlerts(chatId:number){
        const keyboard:InlineKeyboardMarkup = {
            inline_keyboard:[
                [{text:"▶️ Start Triangular Arbitrage Alerts (Manual Trade)", callback_data:"profit_alerts"}],
                [{text:"⏹️ Stop Triangular Arbitrage Alerts (Manual Trade)", callback_data:"stop_triangular_alerts"}]
            ]
        }
        try {
            await this.bot.sendMessage({
                chat_id:chatId,
                text:"Get triangular trade opportunity alerts.",
                reply_markup:keyboard
            })
        } catch (error) {
            console.log(`Error occured while getting trade alerts: `, error);
        }
    }

    async opportunityAlertsAutoTrade(chatId:number){
        const keyboard:InlineKeyboardMarkup = {
            inline_keyboard:[
                [{text:"▶️ Start Triangular Arbitrage Alerts (Auto Trade)", callback_data:"auto_profit_alerts"}],
                [{text:"⏹️ Stop Triangular Arbitrage Alerts (Auto Trade)", callback_data:"stop_triangular_alerts"}]
            ]
        }
        try {
            await this.bot.sendMessage({
                chat_id:chatId,
                text:"Get triangular trade opportunity alerts.",
                reply_markup:keyboard
            })
        } catch (error) {
            console.log(`Error occured while getting trade alerts: `, error);
        }
    }


     async showAlertsAutoTrade(chatId:any, respsone:any){
        const chat_id = chatId;
        if(!chatId) return;
        try {
        const firstSymbol = respsone?.firstTradepair.slice(3,6);
        const secondSymbol = respsone?.firstTradepair.slice(0,3);
        const thirdSymbol = respsone?.secondTradepair.slice(3,6);
        const telegramMessage = `💹 *🚀 Trade Opportunity Detected\\!*  
        💰 *Initial Capital:* \`${respsone?.initialQuoteNumber} USDT\`  
        🏦 *Exchanges Involved:* 1️⃣ ${respsone?.firstExchange}  2️⃣ ${respsone?.secondExchange}  3️⃣ ${respsone?.thirdExchange}  
        🔗 *Trade Pairs:* \\- ${respsone?.firstTradepair} \\- ${respsone?.secondTradepair} \\- ${respsone?.thirdTradepair}  
        📊 *Trades Breakdown:*

        1️⃣ *First Trade:* \`${firstSymbol} → ${secondSymbol}\`  
        💵 Spent: \`${respsone?.firstSim.receivedQuote} ${firstSymbol}\`  
        🛒 Bought: \`${respsone?.baseAfterFirstSim} ${secondSymbol}\`

        2️⃣ *Second Trade:* \`${secondSymbol} → ${thirdSymbol}\`  
        💵 Spent: \`${respsone?.baseAfterFirstSim} ${secondSymbol}\`  
        🛒 Bought: \`${respsone?.receivedQuoteAfterSecondSim} ${thirdSymbol}\`

        3️⃣ *Third Trade:* \`${thirdSymbol} → ${firstSymbol}\`  
        💵 Spent: \`${respsone.receivedQuoteAfterSecondSim} ${thirdSymbol}\`  
        🛒 Bought: \`${respsone.receivedQuoteAfterThirdSim} ${firstSymbol}\`

        🏆 *Expected Profit:* \`${respsone.expectedProfit.toFixed(8)} USDT\`  
        🎉 *Status:* ✅ Profitable Opportunity\\!`;
        const tradeId = `arb_${Date.now()}`
        this.tempTrades.set(tradeId,respsone)
            await this.bot.sendMessage({
            chat_id:chatId,
            text:telegramMessage,
            parse_mode:'MarkdownV2',            
        })
        
          const tradeParams = this.tempTrades.get(tradeId);
          console.log(tradeParams);
          const exchanges = [allExchanges[tradeParams?.firstExchange as ExchangeName], allExchanges[tradeParams?.secondExchange as ExchangeName], allExchanges[tradeParams?.thirdExchange as ExchangeName]];
          const amounts = [tradeParams?.initialQuoteNumber, tradeParams?.baseAfterFirstSim, tradeParams?.receivedQuoteAfterSecondSim];
          const tradePairs = [tradeParams?.firstTradepair, tradeParams?.secondTradepair, tradeParams?.thirdTradepair];
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
            console.log("Error sending Telegram alert:", error);
        }

    }


    async showAlerts(chatId:any, respsone:any){
        const chat_id = chatId;
        if(!chatId) return;
        try {
        const firstSymbol = respsone?.firstTradepair.slice(3,6);
        const secondSymbol = respsone?.firstTradepair.slice(0,3);
        const thirdSymbol = respsone?.secondTradepair.slice(3,6);
        const telegramMessage = `💹 *🚀 Trade Opportunity Detected\\!*  
        💰 *Initial Capital:* \`${respsone?.initialQuoteNumber} USDT\`  
        🏦 *Exchanges Involved:* 1️⃣ ${respsone?.firstExchange}  2️⃣ ${respsone?.secondExchange}  3️⃣ ${respsone?.thirdExchange}  
        🔗 *Trade Pairs:* \\- ${respsone?.firstTradepair} \\- ${respsone?.secondTradepair} \\- ${respsone?.thirdTradepair}  
        📊 *Trades Breakdown:*

        1️⃣ *First Trade:* \`${firstSymbol} → ${secondSymbol}\`  
        💵 Spent: \`${respsone?.firstSim.receivedQuote} ${firstSymbol}\`  
        🛒 Bought: \`${respsone?.baseAfterFirstSim} ${secondSymbol}\`

        2️⃣ *Second Trade:* \`${secondSymbol} → ${thirdSymbol}\`  
        💵 Spent: \`${respsone?.baseAfterFirstSim} ${secondSymbol}\`  
        🛒 Bought: \`${respsone?.receivedQuoteAfterSecondSim} ${thirdSymbol}\`

        3️⃣ *Third Trade:* \`${thirdSymbol} → ${firstSymbol}\`  
        💵 Spent: \`${respsone.receivedQuoteAfterSecondSim} ${thirdSymbol}\`  
        🛒 Bought: \`${respsone.receivedQuoteAfterThirdSim} ${firstSymbol}\`

        🏆 *Expected Profit:* \`${respsone.expectedProfit.toFixed(8)} USDT\`  
        🎉 *Status:* ✅ Profitable Opportunity\\!`;
        const tradeId = `arb_${Date.now()}`
        this.tempTrades.set(tradeId,respsone)
            await this.bot.sendMessage({
            chat_id:chatId,
            text:telegramMessage,
            parse_mode:'MarkdownV2',
            reply_markup:{
                inline_keyboard:[
                    [
                        {
                            text:"💰 Trade this opportunity.",
                            callback_data:`triangular_trade|${tradeId}`
                        }
                    ]
                ]
            }
        })            
        } catch (error) {
            console.log("Error sending Telegram alert:", error);

        }

    }


    async selectTradeType(chatId:number){
      const keyboard:InlineKeyboardMarkup = {
        inline_keyboard:[
            [{text:'🤖 Auto Trade', callback_data:'triangular_auto_trade'}],
            [{text:'🚀 Manual Trade', callback_data:'triangular_manual_trade'}]
        ]
    }
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:'Select the trade option for triangular arbitrage alerts',
            reply_markup:keyboard
        })
    } catch (error) {
        console.log(`Error occured while select triangular trade type send message: `, error)
    }
  }
}