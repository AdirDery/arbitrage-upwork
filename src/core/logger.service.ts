export class LoggerService {
    log(message: string) {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    }

    error(message: string, error?: any) {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
    }
}



import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs"

const logDir = path.join(__dirname,"..logs");
if(!fs.existsSync(logDir)){
    fs.mkdirSync(logDir)
}


const rotateTransport = new DailyRotateFile({
    filename:path.join(logDir, "bot-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    zippedArchive: false, 
    maxSize: "20m",       
    maxFiles: "14d"
})


const logger = winston.createLogger({
    level:'info',
    format:winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports:[
        rotateTransport,
        new winston.transports.Console(),
    ]
})


export default logger;


