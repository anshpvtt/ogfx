create extension if not exists pgcrypto;

create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  pair text not null default 'XAUUSD',
  timeframe text not null default '1H',
  strategy_id text,
  strategy_name text,
  source text not null default 'manual',
  run_group_id uuid,
  start_date date,
  end_date date,
  total_trades integer default 0,
  win_rate numeric,
  profit_factor numeric,
  max_drawdown numeric,
  initial_balance numeric,
  final_balance numeric,
  average_rr numeric,
  sharpe_ratio numeric,
  equity_curve jsonb,
  trade_log jsonb,
  created_at timestamptz not null default now()
);

alter table public.backtests add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.backtests add column if not exists pair text not null default 'XAUUSD';
alter table public.backtests add column if not exists timeframe text not null default '1H';
alter table public.backtests add column if not exists strategy_id text;
alter table public.backtests add column if not exists strategy_name text;
alter table public.backtests add column if not exists source text not null default 'manual';
alter table public.backtests add column if not exists run_group_id uuid;
alter table public.backtests add column if not exists start_date date;
alter table public.backtests add column if not exists end_date date;
alter table public.backtests add column if not exists total_trades integer default 0;
alter table public.backtests add column if not exists win_rate numeric;
alter table public.backtests add column if not exists profit_factor numeric;
alter table public.backtests add column if not exists max_drawdown numeric;
alter table public.backtests add column if not exists initial_balance numeric;
alter table public.backtests add column if not exists final_balance numeric;
alter table public.backtests add column if not exists average_rr numeric;
alter table public.backtests add column if not exists sharpe_ratio numeric;
alter table public.backtests add column if not exists equity_curve jsonb;
alter table public.backtests add column if not exists trade_log jsonb;
alter table public.backtests add column if not exists created_at timestamptz not null default now();

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
  candle_index integer,
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_cron_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('demo_trading', 'strategy_backtest')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists subscriptions_user_id_key on public.subscriptions(user_id);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists backtests_user_created_idx on public.backtests(user_id, created_at desc);
create index if not exists backtests_strategy_created_idx on public.backtests(strategy_id, created_at desc);
create index if not exists backtests_run_group_idx on public.backtests(run_group_id);
create index if not exists backtest_trades_backtest_idx on public.backtest_trades(backtest_id, created_at);
create index if not exists strategy_cron_runs_type_started_idx on public.strategy_cron_runs(run_type, started_at desc);

alter table public.backtests enable row level security;
alter table public.backtest_trades enable row level security;
alter table public.strategy_cron_runs enable row level security;
alter table public.subscriptions enable row level security;

grant select, insert, update, delete on public.backtests to authenticated;
grant select, insert, update, delete on public.backtest_trades to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.backtests to service_role;
grant select, insert, update, delete on public.backtest_trades to service_role;
grant select, insert, update, delete on public.strategy_cron_runs to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;

drop policy if exists "Users can read own backtests" on public.backtests;
drop policy if exists "Users can insert own backtests" on public.backtests;
drop policy if exists "Users can update own backtests" on public.backtests;
drop policy if exists "Users can delete own backtests" on public.backtests;
drop policy if exists "Service role full access to backtests" on public.backtests;

create policy "Users can read own backtests"
  on public.backtests for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own backtests"
  on public.backtests for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own backtests"
  on public.backtests for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own backtests"
  on public.backtests for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Service role full access to backtests"
  on public.backtests for all
  to service_role
  using (true)
  with check (true);

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

drop policy if exists "Service role reads cron runs" on public.strategy_cron_runs;
drop policy if exists "Service role writes cron runs" on public.strategy_cron_runs;

create policy "Service role reads cron runs"
  on public.strategy_cron_runs for select
  to service_role
  using (true);

create policy "Service role writes cron runs"
  on public.strategy_cron_runs for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Users can read own subscriptions" on public.subscriptions;
drop policy if exists "Users can insert own subscriptions" on public.subscriptions;
drop policy if exists "Users can update own subscriptions" on public.subscriptions;
drop policy if exists "Service role full access to subscriptions" on public.subscriptions;

create policy "Users can read own subscriptions"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own subscriptions"
  on public.subscriptions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own subscriptions"
  on public.subscriptions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Service role full access to subscriptions"
  on public.subscriptions for all
  to service_role
  using (true)
  with check (true);

select pg_notify('pgrst', 'reload schema');
