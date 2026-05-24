create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  pair text,
  timeframe text,
  signal text not null default 'NO_SETUP',
  bias text,
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  risk_reward numeric,
  confidence text,
  confirmation_type text,
  created_at timestamptz default now()
);

alter table public.signals add column if not exists user_id uuid references auth.users(id);
alter table public.signals add column if not exists pair text;
alter table public.signals add column if not exists timeframe text;
alter table public.signals add column if not exists bias text;
alter table public.signals add column if not exists entry numeric;
alter table public.signals add column if not exists stop_loss numeric;
alter table public.signals add column if not exists take_profit numeric;
alter table public.signals add column if not exists risk_reward numeric;
alter table public.signals add column if not exists confirmation_type text;
alter table public.signals add column if not exists created_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'signals'
      and column_name = 'confidence'
      and data_type <> 'text'
  ) then
    alter table public.signals alter column confidence type text using confidence::text;
  end if;
end $$;

do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.signals'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%signal%'
  loop
    execute format('alter table public.signals drop constraint if exists %I', check_constraint.conname);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'signals'
      and column_name = 'symbol'
  ) then
    execute 'update public.signals set pair = coalesce(pair, symbol) where pair is null';
  end if;
end $$;

update public.signals set signal = 'NO_SETUP' where signal in ('SKIP', 'WAIT');
update public.signals set pair = coalesce(pair, 'XAUUSD') where pair is null;
update public.signals set timeframe = coalesce(timeframe, '15m') where timeframe is null;

alter table public.signals alter column signal set default 'NO_SETUP';
alter table public.signals alter column confidence drop not null;
alter table public.signals drop constraint if exists signals_signal_check;
alter table public.signals add constraint signals_signal_check check (signal in ('BUY', 'SELL', 'NO_SETUP'));

create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  pair text not null default 'XAUUSD',
  timeframe text not null default '15m',
  start_date date,
  end_date date,
  initial_balance numeric,
  total_trades int,
  win_rate numeric,
  profit_factor numeric,
  max_drawdown numeric,
  average_rr numeric,
  final_balance numeric,
  sharpe_ratio numeric,
  equity_curve jsonb,
  trade_log jsonb,
  strategy_id text,
  strategy_name text,
  source text not null default 'manual',
  run_group_id uuid,
  created_at timestamptz default now()
);

alter table public.backtests add column if not exists user_id uuid references auth.users(id);
alter table public.backtests add column if not exists pair text;
alter table public.backtests add column if not exists timeframe text;
alter table public.backtests add column if not exists start_date date;
alter table public.backtests add column if not exists end_date date;
alter table public.backtests add column if not exists initial_balance numeric;
alter table public.backtests add column if not exists total_trades int;
alter table public.backtests add column if not exists win_rate numeric;
alter table public.backtests add column if not exists profit_factor numeric;
alter table public.backtests add column if not exists max_drawdown numeric;
alter table public.backtests add column if not exists average_rr numeric;
alter table public.backtests add column if not exists final_balance numeric;
alter table public.backtests add column if not exists sharpe_ratio numeric;
alter table public.backtests add column if not exists equity_curve jsonb;
alter table public.backtests add column if not exists trade_log jsonb;
alter table public.backtests add column if not exists strategy_id text;
alter table public.backtests add column if not exists strategy_name text;
alter table public.backtests add column if not exists source text not null default 'manual';
alter table public.backtests add column if not exists run_group_id uuid;
alter table public.backtests add column if not exists created_at timestamptz default now();

update public.backtests set pair = coalesce(pair, 'XAUUSD') where pair is null;
update public.backtests set timeframe = coalesce(timeframe, '15m') where timeframe is null;
alter table public.backtests alter column pair set not null;
alter table public.backtests alter column timeframe set not null;

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

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.demo_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'USD',
  initial_balance numeric not null default 10000 check (initial_balance > 0),
  balance numeric not null default 10000,
  equity numeric not null default 10000,
  free_margin numeric not null default 10000,
  margin numeric not null default 0,
  margin_level numeric,
  realized_pnl numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.demo_account_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auto_trading_enabled boolean not null default false,
  risk_per_trade numeric not null default 0.01 check (risk_per_trade >= 0.001 and risk_per_trade <= 0.05),
  max_open_trades integer not null default 5 check (max_open_trades >= 1 and max_open_trades <= 25),
  default_size numeric not null default 1 check (default_size > 0),
  watched_assets text[] not null default array['XAUUSD','EURUSD','GBPUSD','BTCUSD','ETHUSD'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.demo_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null,
  trading_view_symbol text,
  side text not null check (side in ('BUY', 'SELL')),
  entry numeric not null,
  stop_loss numeric not null,
  take_profit numeric not null,
  size numeric not null check (size > 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'TP', 'SL', 'CLOSED')),
  source text not null default 'manual' check (source in ('manual', 'agent', 'agent-cron')),
  strategy_id text,
  strategy_name text,
  confidence numeric,
  reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric,
  pnl numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create unique index if not exists subscriptions_user_id_key on public.subscriptions(user_id);
create unique index if not exists demo_accounts_user_id_key on public.demo_accounts(user_id);
create unique index if not exists demo_account_settings_user_id_key on public.demo_account_settings(user_id);
create index if not exists signals_user_created_idx on public.signals(user_id, created_at desc);
create index if not exists signals_pair_created_idx on public.signals(pair, created_at desc);
create index if not exists backtests_user_created_idx on public.backtests(user_id, created_at desc);
create index if not exists backtests_strategy_created_idx on public.backtests(strategy_id, created_at desc);
create index if not exists backtests_run_group_idx on public.backtests(run_group_id);
create index if not exists backtest_trades_backtest_idx on public.backtest_trades(backtest_id, created_at);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists demo_orders_user_status_idx on public.demo_orders(user_id, status, opened_at desc);
create index if not exists demo_orders_asset_status_idx on public.demo_orders(asset_id, status);
create index if not exists strategy_cron_runs_type_started_idx on public.strategy_cron_runs(run_type, started_at desc);

drop trigger if exists set_demo_accounts_updated_at on public.demo_accounts;
create trigger set_demo_accounts_updated_at
  before update on public.demo_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists set_demo_account_settings_updated_at on public.demo_account_settings;
create trigger set_demo_account_settings_updated_at
  before update on public.demo_account_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_demo_orders_updated_at on public.demo_orders;
create trigger set_demo_orders_updated_at
  before update on public.demo_orders
  for each row execute function public.set_updated_at();

alter table public.signals enable row level security;
alter table public.backtests enable row level security;
alter table public.backtest_trades enable row level security;
alter table public.subscriptions enable row level security;
alter table public.demo_accounts enable row level security;
alter table public.demo_account_settings enable row level security;
alter table public.demo_orders enable row level security;
alter table public.strategy_cron_runs enable row level security;

drop policy if exists "Users can read own signals" on public.signals;
drop policy if exists "Users can insert own signals" on public.signals;
drop policy if exists "Users can update own signals" on public.signals;
drop policy if exists "Users can delete own signals" on public.signals;
drop policy if exists "Service role full access to signals" on public.signals;

create policy "Users can read own signals"
  on public.signals for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own signals"
  on public.signals for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own signals"
  on public.signals for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own signals"
  on public.signals for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Service role full access to signals"
  on public.signals for all
  to service_role
  using (true)
  with check (true);

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

drop policy if exists "Users can read own demo account" on public.demo_accounts;
drop policy if exists "Users can insert own demo account" on public.demo_accounts;
drop policy if exists "Users can update own demo account" on public.demo_accounts;
drop policy if exists "Service role full access to demo accounts" on public.demo_accounts;

create policy "Users can read own demo account"
  on public.demo_accounts for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own demo account"
  on public.demo_accounts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own demo account"
  on public.demo_accounts for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Service role full access to demo accounts"
  on public.demo_accounts for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Users can read own demo settings" on public.demo_account_settings;
drop policy if exists "Users can insert own demo settings" on public.demo_account_settings;
drop policy if exists "Users can update own demo settings" on public.demo_account_settings;
drop policy if exists "Service role full access to demo settings" on public.demo_account_settings;

create policy "Users can read own demo settings"
  on public.demo_account_settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own demo settings"
  on public.demo_account_settings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own demo settings"
  on public.demo_account_settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Service role full access to demo settings"
  on public.demo_account_settings for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Users can read own demo orders" on public.demo_orders;
drop policy if exists "Users can insert own demo orders" on public.demo_orders;
drop policy if exists "Users can update own demo orders" on public.demo_orders;
drop policy if exists "Users can delete own demo orders" on public.demo_orders;
drop policy if exists "Service role full access to demo orders" on public.demo_orders;

create policy "Users can read own demo orders"
  on public.demo_orders for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own demo orders"
  on public.demo_orders for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own demo orders"
  on public.demo_orders for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own demo orders"
  on public.demo_orders for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Service role full access to demo orders"
  on public.demo_orders for all
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

do $$
begin
  alter publication supabase_realtime add table public.signals;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.demo_accounts;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.demo_orders;
exception
  when duplicate_object then null;
end $$;
