import { Transaction } from "./transaction.model";
import { transaction } from "./transaction.type";
import { DirectArbitrageAlerts } from "../telegram/directArbitrageAlerts.service";


export class Transactions{

  
  constructor(private showTransactionHistory: (chatId:string, message:any) => Promise<void>){
  }

  async saveTransaction (transaction:transaction) {
    //create a sequenceId here to keep it consistent across same cycle of transaction.
  try {
   const response = await Transaction.create(transaction);
    console.log('Transaction details saved in Database.');
    return response;  
  } catch (error) {
    console.log(`Error while saving transaction details: `, error);
  }  
};



async getTransactionHistory(chatId:any) {
  try {
    console.log('Transaction history function runs....')
    const response = await Transaction.aggregate([
      {$sort:{timestamp:1}},

      {
        $group:{
          _id:"$sequenceId",
          type:{$first:'$type'},
          transactions: {$push:"$$ROOT"},
          createdAt:{$first:"$timestamp"},
        },
      },
      { $sort: { createdAt: 1 } },
    ])
    //console.log(response)
    this.showTransactionHistory(chatId,response);
    return response;
  } catch (error) {
    console.error("Error fetching grouped transactions:", error);
    //throw error;
  }
}
}
