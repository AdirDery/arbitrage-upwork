import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
    type:{
        type:String,
        enum:['direct','triangluar'],
        required:true
    },
    sequenceId: {  // sequenceId links all the transactions of one whole cycle
        type:String,
        required:true,
        index:true
    },
    leg:{
        type:Number,
        required:true,
        enum:[1,2,3]
    },
    symbol:{
        type:String,
        required:true,
    },
    side:{
        type:String,
        enum:['BUY','SELL'],
        required:true
    },
    // price:{
    //     type:Number
    // },
    quantity:{
        type:Number
    },
    assetGiven:{
        type:String
    },
    assetReceived:{
        type:String
    },
    // amountGiven:{
    //     type:Number
    // },
    // amountReceived:{
    //     type:Number
    // },
    status:{
        type:String,
        enum:['PENDING','SUCCESS','FAILED'],
        default:'PENDING'
    },
    responseMsg:{
        type:String
    },
    errorMsg:{
        type:String
    },
    orderId:{
        type:String
    },
    exchange:{
        type:String
    },
    timestamp:{
        type:Date,
        default:Date.now
    }
})

const tradeResults = new mongoose.Schema({
    
})



export const Transaction = mongoose.model('Transaction', transactionSchema);