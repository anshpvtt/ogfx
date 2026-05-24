create extension if not exists pgcrypto;

create table if not exists public.backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references public.backtests(id) on delete cascade,
  type text check (type in ('BUY', 'SELL')),
  entry numeric,
  sl numeric,
  tp numeric,
  result text,
  pnl numeric,
  balance numeric,
  confidence numeric,
  rr numeric,
  reason text,
  candle_index int,
  created_at timestamptz default now()
);

alter table public.backtests add column if not exists initial_balance numeric;
alter table public.backtests add column if not exists average_rr numeric;

create index if not exists backtest_trades_backtest_idx on public.backtest_trades(backtest_id, created_at);

alter table public.backtest_trades enable row level security;

drop policy if exists "Users can read own backtest trades" on public.backtest_trades;
drop policy if exists "Service role full access to backtest trades" on public.backtest_trades;

create policy "Users can read own backtest trades"
  on public.backtest_trades for select
  to authenticated
  using (
    exists (
      select 1
      from public.backtests b
      where b.id = backtest_id
        and b.user_id = (select auth.uid())
    )
  );

create policy "Service role full access to backtest trades"
  on public.backtest_trades for all
  to service_role
  using (true)
  with check (true);
