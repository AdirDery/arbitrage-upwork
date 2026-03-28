import { InlineKeyboardMarkup, TelegramBot } from "typescript-telegram-bot-api";
import { Arbitration } from "../arbitrage/directArbitrage.service";
import { ArbOpportunity } from "../arbitrage/arbitrage.types";
import { allExchanges, ExchangeName } from "../paths/symbols";
import { Transactions } from "../transactions/transaction.service";


export class DirectArbitrageAlerts {
  private bot: TelegramBot;
  public tempTrades: Map<string, any>;
  private directArb: Arbitration;
  private transactions: Transactions

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.tempTrades = new Map();
    this.transactions = new Transactions(this.showTransactionHistory.bind(this));
    this.directArb = new Arbitration(bot,this.transactions);
  }

  

  async opportunityAlerts(chatId: number) {
    const keyboard:InlineKeyboardMarkup = {
        inline_keyboard:[
            [{text:'▶️ Start Direct Arbitrage Alerts (Manual Trade)', callback_data:'direct_profit_alerts'}],
            [{text:'⏹️ Stop Direct Arbitrage Alerts (Manual Trade)', callback_data:'stop_direct_profit_alerts'}]

        ]
    }
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:'Get direct arbitrage trade opportunities.',
            reply_markup:keyboard
        })
    } catch (error) {
        console.log(`Error occured while getting direct arbitrage trade alerts: `, error)
    }
  }

  async opprtunityAlertsAutoTrade(chatId:number){
    const keyboard:InlineKeyboardMarkup = {
        inline_keyboard:[
            [{text:'▶️ Start Direct Arbitrage Alerts (Auto Trade)', callback_data:'auto_direct_profit_alerts'}],
            [{text:'⏹️ Stop Direct Arbitrage Alerts (Auto Trade)', callback_data:'auto_stop_direct_profit_alerts'}]

        ]
    }
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:'Get direct arbitrage trade opportunities.',
            reply_markup:keyboard
        })
    } catch (error) {
        console.log(`Error occured while getting direct arbitrage trade alerts: `, error)
    }
  }


  async ShowAlertsWithAutoTrades(chatId:any, response:any){
    const chat_id = chatId;
    if(!chatId) return;
    console.log('=======================ShowAlertsWithAutoTrades=====================')
    try {
      const {size, symbol, firstExchange, secondExchange, netProfit} = response;
      const telegramMessage = `💹 *🚀 Trade Opportunity Detected\\!*
      💰 *Trade size:* \`${size} ${symbol}\`
      🏦 *Exchanges Involved:* 1️⃣${firstExchange}   2️⃣${secondExchange}   
      🏆 *Expected Profit:* \`${netProfit} USDT\`  
      🎉 *Status:* ✅ Profitable Opportunity\\!
      `;

      await this.bot.sendMessage({
        chat_id:chatId,
        text:telegramMessage,
        parse_mode:'MarkdownV2'
      })

      const tradeId = `arb_${Date.now()}`
      this.tempTrades.set(tradeId,response);
      //execute the trade
      const tradeParams = this.tempTrades.get(tradeId);
      console.log('direct trade param ',tradeParams);

      const params:ArbOpportunity = {
        buyExchange: allExchanges[tradeParams?.firstExchange as ExchangeName],
        sellExchange: allExchanges[tradeParams?.secondExchange as ExchangeName],
        symbol: tradeParams.symbol,
        size: tradeParams.size,
        netProfit: tradeParams.netProfit,
        roi: tradeParams.roi,
        cost: tradeParams.cost,
        proceeds: tradeParams.proceeds,          
      }
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
    } catch (error) {
      console.error(`Error occured while `)
    }
  }

  async showAlerts(chatId:any, response:any){
    const chat_id = chatId;
    if(!chatId) return;
    const {size, symbol, firstExchange, secondExchange, netProfit} = response;
    const telegramMessage = `💹 *🚀 Trade Opportunity Detected\\!*
      💰 *Trade size:* \`${size} ${symbol}\`
      🏦 *Exchanges Involved:* 1️⃣${firstExchange}   2️⃣${secondExchange}   
      🏆 *Expected Profit:* \`${netProfit} USDT\`  
      🎉 *Status:* ✅ Profitable Opportunity\\!
      `;

      const tradeId = `arb_${Date.now()}`
      this.tempTrades.set(tradeId,response);
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:telegramMessage,
            parse_mode:'MarkdownV2',
            reply_markup:{
              inline_keyboard:[
                [
                  {
                    text:"💰 Trade this opportunity.",
                    callback_data:`direct_trade|${tradeId}`
                  }
                ]
              ]
            }
        })
    } catch (error) {
        console.log('Error occured while sending direct arbitrage telegram alerts: ', error);
    }
  }

  async transactionHistory(chatId:any){
        const keyboard:InlineKeyboardMarkup = {
        inline_keyboard:[
            [{text:'Get Transaction History', callback_data:'transaction_history'}]
        ]
    }
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:'Fetch transaction history',
            reply_markup:keyboard
        })
    } catch (error) {
        console.log(`Error occured while getting transaction history: `, error)
    }
  }

  async showTransactionHistory(chatId:any, response:any){
    const chat_id = chatId;
    if(!chatId) return;
    try {
    await this.bot.sendMessage({
    chat_id: chatId,
    text: `*💹 LIST OF TRANSACTIONS*\n━━━━━━━━━━━━━━━━━━━━━━━`,
    parse_mode: "MarkdownV2",
  });

      for (let i = 0; i < response.length; i++) {
      let message = `📊 *Trade ${i + 1}*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
      const txList = response[i].transactions;

      for (let j = 0; j < txList.length; j++) {
        const tx = txList[j];
        const sideEmoji = tx.side?.toLowerCase() === "buy" ? "🟢" : "🔴";
        const statusEmoji =
          tx.status?.toLowerCase() === "success"
            ? "✅"
            : tx.status?.toLowerCase() === "failed"
            ? "❌"
            : "⏳";

    message += `
    📄 *Leg:* ${tx.leg}
    🆔 *Sequence ID:* \`${tx.sequenceId}\`
    💱 *Symbol:* \`${tx.symbol}\`
    ${sideEmoji} *Side:* ${tx.side?.toUpperCase()}
    📦 *Quantity:* \`${tx.quantity}\`
    💰 *Executed Price:* \`${tx.price || "N/A"} USDT\`
    ⚙️ *Status:* ${statusEmoji} *${tx.status?.toUpperCase()}*
    🕒 *Timestamp:* ${new Date(tx.timestamp).toUTCString()}
    ━━━━━━━━━━━━━━━━━━━━━━━
    📊 *Profit:* ${tx.profit ? `+\`${tx.profit} USDT\`` : "`N/A`"}
    🏦 *Exchanges:* ${tx.firstExchange || "?"} → ${tx.secondExchange || "?"}
    ━━━━━━━━━━━━━━━━━━━━━━━
    🔍 *Transaction ID:* \`${tx.txId || "N/A"}\`\n`;
      }

      console.log(message);
        await this.bot.sendMessage({
        chat_id:chatId,
        text:message,
        parse_mode:'MarkdownV2',
      })
    }
    } catch (error) {
      console.error(`Error occured during show transaction telegram service: ${error}`)
    }    
  }


  async selectTradeType(chatId:number){
      const keyboard:InlineKeyboardMarkup = {
        inline_keyboard:[
            [{text:'🤖 Auto Trade', callback_data:'direct_auto_trade'}],
            [{text:'🚀 Manual Trade', callback_data:'direct_manual_trade'}]
        ]
    }
    try {
        await this.bot.sendMessage({
            chat_id:chatId,
            text:'Select the trade option for direct arbitrage alerts',
            reply_markup:keyboard
        })
    } catch (error) {
        console.log(`Error occured while select direct trade type: `, error)
    }
  }
}
