const DEFAULT_SYMBOLS = [
  { symbol: "XAUUSD", name: "Gold", category: "METALS", exchange: "OANDA" },
  { symbol: "BTCUSD", name: "Bitcoin", category: "CRYPTO", exchange: "BINANCE" },
  { symbol: "USOIL", name: "Crude Oil", category: "COMMODITY", exchange: "TVC" },
  { symbol: "GBPUSD", name: "GBP/USD", category: "FOREX", exchange: "OANDA" },
  { symbol: "EURUSD", name: "EUR/USD", category: "FOREX", exchange: "OANDA" },
  { symbol: "USDJPY", name: "USD/JPY", category: "FOREX", exchange: "OANDA" },
  { symbol: "AUDUSD", name: "AUD/USD", category: "FOREX", exchange: "OANDA" },
  { symbol: "USDCAD", name: "USD/CAD", category: "FOREX", exchange: "OANDA" },
  { symbol: "ETHUSD", name: "Ethereum", category: "CRYPTO", exchange: "BINANCE" },
];

export async function symbolsRoutes(fastify) {
  // Get all available symbols
  fastify.get("/", async () => {
    return {
      symbols: DEFAULT_SYMBOLS,
      count: DEFAULT_SYMBOLS.length,
    };
  });

  // Get symbols by category
  fastify.get("/category/:category", async (request, reply) => {
    const { category } = request.params;
    const filtered = DEFAULT_SYMBOLS.filter(
      (s) => s.category.toLowerCase() === category.toLowerCase()
    );

    if (filtered.length === 0) {
      reply.status(404);
      return { error: "Category not found" };
    }

    return { symbols: filtered, count: filtered.length };
  });

  // Get single symbol
  fastify.get("/:symbol", async (request, reply) => {
    const { symbol } = request.params;
    const found = DEFAULT_SYMBOLS.find(
      (s) => s.symbol.toLowerCase() === symbol.toLowerCase()
    );

    if (!found) {
      reply.status(404);
      return { error: "Symbol not found" };
    }

    return { symbol: found };
  });
}
