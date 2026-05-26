import type { ArbOpportunity, ExchangePrice } from "@/lib/arbTypes";

const ROUND_TRIP_FEE_PCT = 0.2;
const MIN_SPREAD_PCT = 0.15;
const EXCHANGE_RELIABILITY: Record<string, number> = {
  Binance: 96,
  Coinbase: 94,
  Kraken: 91,
  OKX: 89,
  Bybit: 88,
};

function groupByCoin(prices: ExchangePrice[]) {
  return prices.reduce<Record<string, ExchangePrice[]>>((groups, price) => {
    groups[price.coinId] = groups[price.coinId] || [];
    groups[price.coinId].push(price);
    return groups;
  }, {});
}

function confidenceFor(spreadPercent: number, buyExchange: string, sellExchange: string) {
  const exchangeScore = ((EXCHANGE_RELIABILITY[buyExchange] || 80) + (EXCHANGE_RELIABILITY[sellExchange] || 80)) / 2;
  const spreadScore = Math.min(25, Math.max(0, (spreadPercent - MIN_SPREAD_PCT) * 80));
  return Math.max(35, Math.min(99, Math.round(exchangeScore * 0.7 + spreadScore)));
}

function expiresWindow(coinId: string, timestamp: number, spreadPercent: number) {
  let hash = 0;
  const source = `${coinId}:${Math.floor(timestamp / 1000)}`;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  const base = 8000 + (hash % 22000);
  return Math.max(5000, Math.round(base - Math.min(9000, spreadPercent * 1200)));
}

export function scanForArbitrage(prices: ExchangePrice[], now = Date.now()): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];
  const groups = groupByCoin(prices);

  for (const [coinId, rows] of Object.entries(groups)) {
    if (rows.length < 2) continue;
    const buy = rows.reduce((best, row) => row.ask < best.ask ? row : best, rows[0]);
    const sell = rows.reduce((best, row) => row.bid > best.bid ? row : best, rows[0]);
    if (buy.exchange === sell.exchange) continue;

    const spreadUSD = sell.bid - buy.ask;
    const spreadPercent = (spreadUSD / buy.ask) * 100;
    if (spreadPercent <= MIN_SPREAD_PCT) continue;

    const estimatedProfit = spreadUSD - buy.ask * 0.001 - sell.bid * 0.001;
    const estimatedProfitPer1000 = 1000 * ((spreadPercent - ROUND_TRIP_FEE_PCT) / 100);
    if (estimatedProfitPer1000 <= 0) continue;

    opportunities.push({
      id: `${coinId}-${buy.exchange}-${sell.exchange}-${Math.floor(now / 1000)}`,
      coin: buy.coin,
      coinId,
      buyExchange: buy.exchange,
      sellExchange: sell.exchange,
      buyPrice: buy.ask,
      sellPrice: sell.bid,
      spreadPercent,
      spreadUSD,
      estimatedProfit,
      estimatedProfitPer1000,
      confidence: confidenceFor(spreadPercent, buy.exchange, sell.exchange),
      expiresInMs: expiresWindow(coinId, now, spreadPercent),
      timestamp: now,
    });
  }

  return opportunities
    .sort((left, right) => right.estimatedProfitPer1000 - left.estimatedProfitPer1000)
    .slice(0, 20);
}

export function opportunityAgeLeft(opportunity: ArbOpportunity, now = Date.now()) {
  return Math.max(0, opportunity.expiresInMs - (now - opportunity.timestamp));
}
