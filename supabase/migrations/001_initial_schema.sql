-- OGFX — Initial Database Schema
-- Run this in your Supabase SQL Editor

-- ═══════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════
-- SIGNALS TABLE
-- ═══════════════════════════════════════════════════════════
create table if not exists public.signals (
  id              uuid primary key default uuid_generate_v4(),
  symbol          text not null,
  signal          text not null check (signal in ('BUY', 'SELL', 'SKIP')),
  confidence      integer not null default 0,
  reason          text,
  strategy_id     text,
  strategy_name   text,
  entry_price     numeric(20, 8),
  stop_loss       numeric(20, 8),
  take_profit     numeric(20, 8),
  risk_reward     numeric(6, 2),
  rsi             numeric(6, 2),
  ema_50          numeric(20, 8),
  ema_200         numeric(20, 8),
  macd            numeric(20, 8),
  market_bias     text,
  key_factors     text[],
  status          text not null default 'pending' check (status in ('pending', 'executed', 'failed', 'cancelled')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_signals_symbol       on public.signals(symbol);
create index if not exists idx_signals_created_at   on public.signals(created_at desc);
create index if not exists idx_signals_status        on public.signals(status);
create index if not exists idx_signals_signal_type  on public.signals(signal);

-- Enable Realtime
alter publication supabase_realtime add table public.signals;

-- ═══════════════════════════════════════════════════════════
-- TRADES TABLE
-- ═══════════════════════════════════════════════════════════
create table if not exists public.trades (
  id           uuid primary key default uuid_generate_v4(),
  signal_id    uuid references public.signals(id) on delete set null,
  symbol       text not null,
  direction    text not null check (direction in ('BUY', 'SELL')),
  entry_price  numeric(20, 8) not null,
  exit_price   numeric(20, 8),
  stop_loss    numeric(20, 8) not null,
  take_profit  numeric(20, 8) not null,
  lot_size     numeric(10, 4) not null default 0.01,
  pnl          numeric(12, 4),
  status       text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  mt5_ticket   bigint  -- MT5 order ticket for reference
);

create index if not exists idx_trades_symbol    on public.trades(symbol);
create index if not exists idx_trades_status    on public.trades(status);
create index if not exists idx_trades_opened_at on public.trades(opened_at desc);

-- Enable Realtime
alter publication supabase_realtime add table public.trades;

-- ═══════════════════════════════════════════════════════════
-- STRATEGIES TABLE (mirrors strategies.json for UI display)
-- ═══════════════════════════════════════════════════════════
create table if not exists public.strategies (
  id                   text primary key,
  name                 text not null,
  description          text,
  risk_reward          numeric(4, 2),
  win_rate_historical  numeric(5, 4),
  instruments          text[],
  timeframes           text[],
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Seed strategies
insert into public.strategies (id, name, description, risk_reward, win_rate_historical, instruments, timeframes) values
  ('trend_pullback',        'Trend + Pullback',          'Enter in the direction of the major trend after a pullback.', 2.0, 0.64, array['EURUSD','GBPUSD','XAUUSD','BTCUSDT'], array['1h','4h','1d']),
  ('breakout',              'Breakout Strategy',         'Trade the break of a key consolidation zone with volume.',    2.5, 0.58, array['EURUSD','GBPUSD','XAUUSD','BTCUSDT'], array['15m','1h','4h']),
  ('rsi_divergence',        'RSI Divergence',            'Trade trend exhaustion via price/RSI divergence.',            2.0, 0.61, array['EURUSD','GBPUSD','XAUUSD','BTCUSDT'], array['1h','4h']),
  ('support_resistance_bounce', 'S/R Bounce',            'Trade rejections from historically significant S/R zones.',   2.5, 0.66, array['EURUSD','GBPUSD','XAUUSD','BTCUSDT'], array['1h','4h','1d']),
  ('liquidity_sweep',       'Liquidity Sweep',           'Trade reversals after false breaks that sweep stop clusters.', 3.0, 0.59, array['EURUSD','GBPUSD','XAUUSD','BTCUSDT'], array['15m','1h','4h'])
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════
-- ACCOUNT SNAPSHOTS (for equity curve)
-- ═══════════════════════════════════════════════════════════
create table if not exists public.account_snapshots (
  id           uuid primary key default uuid_generate_v4(),
  balance      numeric(14, 2) not null,
  equity       numeric(14, 2) not null,
  open_pnl     numeric(12, 4) not null default 0,
  recorded_at  timestamptz not null default now()
);

create index if not exists idx_snapshots_recorded_at on public.account_snapshots(recorded_at desc);

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════
alter table public.signals            enable row level security;
alter table public.trades             enable row level security;
alter table public.strategies         enable row level security;
alter table public.account_snapshots  enable row level security;

-- Public read-only access (dashboard is public-facing)
create policy "Public can read signals"
  on public.signals for select using (true);

create policy "Public can read trades"
  on public.trades for select using (true);

create policy "Public can read strategies"
  on public.strategies for select using (true);

create policy "Public can read snapshots"
  on public.account_snapshots for select using (true);

-- Service role full access (backend uses service_role key)
create policy "Service role full access to signals"
  on public.signals for all using (auth.role() = 'service_role');

create policy "Service role full access to trades"
  on public.trades for all using (auth.role() = 'service_role');

create policy "Service role full access to strategies"
  on public.strategies for all using (auth.role() = 'service_role');

create policy "Service role full access to snapshots"
  on public.account_snapshots for all using (auth.role() = 'service_role');
