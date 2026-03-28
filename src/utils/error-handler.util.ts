import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../core/logger.service';

const logger = new LoggerService();

export class ErrorHandler {     
    static handleError(err: any, req: Request, res: Response, next: NextFunction) {
        const statusCode = err.statusCode || 500;
        const message = err.message || 'Internal Server Error';
        
        logger.error(`Error occurred: ${message}`, err);

        res.status(statusCode).json({
            success: false,
            error: {
                message,
                statusCode
            }
        });
    }

    static handleUncaughtExceptions() {
        process.on('uncaughtException', (err) => {
            logger.error('Uncaught Exception:', err);
            process.exit(1); // Exit to avoid inconsistent state
        });
    }

    static handleUnhandledRejections() {
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise);
            process.exit(1); // Exit to avoid inconsistent state
        });
    }
}
