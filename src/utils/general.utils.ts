  // Known quote currencies in order of priority (check longer ones first)
  const QUOTE_CURRENCIES = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'SOL'];

  export async function formatSymbol(symbol: string) {
    // Find the quote currency suffix and split there
    for (const quote of QUOTE_CURRENCIES) {
      if (symbol.endsWith(quote) && symbol.length > quote.length) {
        const base = symbol.slice(0, symbol.length - quote.length);
        return `${base}-${quote}`;
      }
    }
    // Fallback: split at 3 for unknown pairs
    return symbol.slice(0, 3) + "-" + symbol.slice(3);
  }



  export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};
