import {
  TelegramBot,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  Message,
} from "typescript-telegram-bot-api";
import { updateConfigField } from "../config/config.service";
import { UserPreferences } from "../config/config.model";

export class ConfigService {
  private bot: TelegramBot;

  constructor(bot: TelegramBot) {
    this.bot = bot;
    
  }

  async selectExchangeCurrency(chatId:number){
      const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [{ text: "💾 Select Exchanges", callback_data: "select_exchange" }],
        [{ text: "💾 Select Currencies", callback_data: "select_currency" }],
        [{ text: "💾 Set direct arbitrage capital", callback_data: "select_direct_arb_size" }],
        [{ text: "💾 Set triangular arbitrage capital", callback_data: "select_triangular_arb_size" }],
        [{ text: "💾 Set slippage tolerance", callback_data: "select_slippage_threshold" }],
        [{ text: "💾 Set minimum profit threshold", callback_data: "select_profit_threshold" }],

      ],
    };

     try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "💱 *Select or unselect the exchanges or currencies*",
        reply_markup: keyboard,
        parse_mode:'MarkdownV2'
      });
    } catch (error) {
      console.error("Error occured during start config: ", error);
    }
  }

  async selectCurrencies(chatId:number){
    try {
      const user = await UserPreferences.findOne()
    } catch (error) {
      console.error(`Error occured while fetching Userpreference: ${error}`);
    }

    const allSymbols = ["SOLUSDT", "ETHUSDT", "BTCUSDT", "ETHBTC"];

     const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "SOLUSDT", callback_data: "symbol_SOLUSDT" },
          { text: "ETHUSDT", callback_data: "symbol_ETHUSDT" },
          { text: "BTCUSDT", callback_data: "symbol_BTCUSDT" },
          /*{ text: "ETHBTC", callback_data: "symbol_ETHBTC" },*/
        ],
        [
      { text: "💾 Save Currencies", callback_data: "save_currency" },
    ],
      ],
    };
    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "💱 *Select or unselect the currencies to scan for direct arbitrage opportunities*",
        reply_markup: keyboard,
        parse_mode:'MarkdownV2'
      });
    } catch (error) {
      console.error("Error occured during start config: ", error);
    }
  }


  async toggleCurrencySymbol(symbol:string){
    try {
       let user = await UserPreferences.findOne();
    if(!user){
      console.log("no user")
      user = new UserPreferences({selectedSymbols: [] });
    }

    const index = user.selectedSymbols.indexOf(symbol);
    if(index === -1){
      user.selectedSymbols.push(symbol)
    }else{
      user.selectedSymbols.splice(index,1)
    }

    await user.save();   
    } catch (error) {
      console.error(`Error occured while toggle currency symbol: ${error}`);
    }
  }


  async selectExchanges(chatId:number){

    try {
    const user = await UserPreferences.findOne()

    const allExchanges = ["Binance", "Bybit", "Okx", "Mexc", "Bingx"];

     const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "Binance", callback_data: "exchange_Binance" },
          { text: "Bybit", callback_data: "exchange_Bybit" },
          { text: "Okx", callback_data: "exchange_Okx" },
          { text: "Mexc", callback_data: "exchange_Mexc" },
          { text: "Bingx", callback_data: "exchange_Bingx" },
        ],
        [
      { text: "💾 Save Exchanges", callback_data: "save_exchanges" },
    ],
      ],
    };
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "💱 *Select or unselect the exchanges to scan for arbitrage opportunities*",
        reply_markup: keyboard,
        parse_mode:'MarkdownV2'
      });
    } catch (error) {
      console.error("Error occured during start config: ", error);
    }
  }


  async toggleExchanges(exchange:string){
    try {
    let user = await UserPreferences.findOne();
    if(!user){
      console.log("no user")
      user = new UserPreferences({selectedExchanges: [] });
    }

    const index = user.selectedExchanges.indexOf(exchange);
    if(index === -1){
      user.selectedExchanges.push(exchange)
    }else{
      user.selectedExchanges.splice(index,1)
    }

    await user.save(); 
    } catch (error) {
      console.error(`Error occured while toggle exchanges: ${error}`)  
    }
  }



  async setDirectArbSize(chatId:number){
    try {
     await this.bot.sendMessage({
      chat_id: chatId,
      text: `*Enter the direct arbitrage alert capital.*\n\`Eg: 0.1, 0.5, 1 (SOL, ETH, BTC)\``,
    });


      const amountListener = async (msg: Message) => {
      try {
        
     
      const amount = Number(msg.text);
      if (isNaN(amount) || amount <= 0) {
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: "Please enter a valid amount.",
        });
        return;
      }

      if (!isNaN(Number(msg.text))) {
        const amount = Number(msg.text);
        
          await updateConfigField("directArbSize",amount)
        

        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: `Direct arbitrage alert is set to ${amount}`,
        });

        this.bot.removeListener("message", amountListener);
      }
      } catch (error) {
        console.error(`Error occured while direct arb size amount listener: ${error}`)  
      }  
    };
    this.bot.on("message", amountListener);
    } catch (error) {
          console.log('Erorr occured while updating direct arb capital')
    }
  }



    async setTriangularArbSize(chatId:number){
      try {
      await this.bot.sendMessage({
      chat_id: chatId,
      text: `*Enter the triangular arbitrage alert capital.*\n\`Eg: 5, 10, 100 (USDT)\``,
    });

      const amountListener = async (msg: Message) => {
        try {
        const amount = Number(msg.text);
        if (isNaN(amount) || amount <= 0) {
          this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: "Please enter a valid amount.",
        });
        return;
      }

      if (!isNaN(Number(msg.text))) {
        const amount = Number(msg.text);
          await updateConfigField("triangularArbSize",amount)
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: `Triangular arbitrage alert is set to ${amount} USDT`,
        });

        this.bot.removeListener("message", amountListener);
      }
      } catch (error) {
        console.error(`Error occured while input listen triangular arb size.`)    
      }
    };
       this.bot.on("message", amountListener);
    } catch (error) {
          console.log('Erorr occured while updating triangular alert capital')
    }
  }
  /*
  async startConfig(chatId: number) {
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "Binance", callback_data: "cex_Binance" },
          { text: "Bybit", callback_data: "cex_Bybit" },
          { text: "BingX", callback_data: "cex_BingX" },
          { text: "Mexc", callback_data: "cex_Mexc" },
          { text: "Okx", callback_data: "cex_Okx" },
        ],
      ],
    };
    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: "Select your CEX:",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error occured during start config: ", error);
    }
  }
*/

  async handleCexSelection(query: any) {
    const cex = query.data.replace("cex_", "");
    try {
    await this.bot.sendMessage({
      chat_id: query.from.id,
      text: `You selected: ${cex}. Please enter the amount.`,
    });

    await this.bot.answerCallbackQuery({
      callback_query_id: query.id,
    });
    } catch (error) {
      console.error(`Error occured while handle cex selection ${error}`)  
    }
  }

  async handleCurrencySelection(query: any) {
    let cex = query.data.replace("cex_", "");
    try {
    await this.bot.sendMessage({
      chat_id: query.from.id,
      text: `You selected: ${cex}. Please enter the amount.`,
    });

    cex = `capital${cex}`

    await this.bot.answerCallbackQuery({
      callback_query_id: query.id,
    });

    const amountListener = async (msg: Message) => {
      try {
        
     
      const amount = Number(msg.text);
      if (isNaN(amount) || amount <= 0) {
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: "Please enter a valid amount.",
        });
        return;
      }

      if (!isNaN(Number(msg.text))) {
        const amount = Number(msg.text);
        
        try {
          await updateConfigField(cex,amount)
        } catch (error) {
          console.log('Erorr occured while updating config capital')
        }

        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: `Config updated with ${cex} amount $${msg.text}`,
        });

        this.bot.removeListener("message", amountListener);
      }
      } catch (error) {
        console.error(`Error occured while currency input listen ${error}`)  
      }
    };
    this.bot.on("message", amountListener);
    } catch (error) {
     console.error(`Error occured while handle currency selection: ${error}`) 
    }
  }

  async setSlippageTolerance(chatId:number){
    try {
    await this.bot.sendMessage({
        chat_id: chatId,
        text: `*Enter the slippage tolerance for trades(in percentage).*\n\`Eg: 5 for 5%\``,
     });

      const amountListener = async (msg: Message) => {
      try {
      const amount = Number(msg.text);
      if (isNaN(amount) || amount <= 0) {
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: "Please enter a valid amount.",
        });
        return;
      }

      if (!isNaN(Number(msg.text))) {
        const amount = Number(msg.text);
        await updateConfigField("slippageTolerance",amount)
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: `Slippage tolerance set to ${amount}% (percent)`,
        });

        this.bot.removeListener("message", amountListener);
      }
      } catch (error) {
        console.error(`Error occured while input listen slippage tolerance: ${error}`)
      }       
    };
    this.bot.on("message", amountListener);
    } catch (error) {
      console.error(`Error occured while set slippage tolerance: ${error}`)  
    }
  }


  async setProfitThreshold(chatId:number){
    try {
    await this.bot.sendMessage({
      chat_id: chatId,
      text: `*Enter the profit threshold.*\n\`Eg: 5 for $5\``,
    });

      const amountListener = async (msg: Message) => {
        try {
          const amount = Number(msg.text);
          if (isNaN(amount) || amount <= 0) {
          this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: "Please enter a valid amount.",
        });
        return;
      }

      if (!isNaN(Number(msg.text))) {
        const amount = Number(msg.text);
        
        await updateConfigField("profitThreshold",amount)
        this.bot.sendMessage({
          chat_id: msg.chat.id,
          text: `Profit threshold set to $ ${amount}`,
        });

        this.bot.removeListener("message", amountListener);
      } 
      } catch (error) {
        console.error(`Error occured during listen input profit threshold: ${error}`)    
      }
    };
    this.bot.on("message", amountListener);
    } catch (error) {
      console.error(`Error occured while set profit threshold: ${error}`)
    }
  }
}
