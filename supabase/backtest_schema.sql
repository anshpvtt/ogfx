-- OGFX Backtesting tables (Supabase / Postgres)
-- Place in Supabase SQL editor and run once.

create extension if not exists pgcrypto;

create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  strategy_name text not null,
  pair text not null,
  timeframe text not null,
  initial_balance numeric not null,
  final_balance numeric not null,
  win_rate numeric not null,
  total_trades int not null,
  profit_factor numeric null,
  max_drawdown numeric null,
  average_rr numeric null,
  created_at timestamptz not null default now()
);

create index if not exists backtests_created_at_idx on public.backtests (created_at desc);
create index if not exists backtests_pair_timeframe_idx on public.backtests (pair, timeframe);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references public.backtests(id) on delete cascade,
  type text not null check (type in ('BUY','SELL')),
  entry numeric not null,
  sl numeric not null,
  tp numeric not null,
  result text not null check (result in ('WIN','LOSS','TIMEOUT')),
  pnl numeric not null,
  balance numeric not null,
  confidence int null,
  rr numeric null,
  reason text null,
  candle_index int null,
  created_at timestamptz not null default now()
);

create index if not exists trades_backtest_id_idx on public.trades (backtest_id);

-- Lock down from public API by default. Backend uses service_role which bypasses RLS.
alter table public.backtests enable row level security;
alter table public.trades enable row level security;

