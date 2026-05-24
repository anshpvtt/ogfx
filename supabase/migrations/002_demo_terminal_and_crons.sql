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
  created_at timestamptz default now()
);

alter table public.backtests add column if not exists strategy_id text;
alter table public.backtests add column if not exists strategy_name text;
alter table public.backtests add column if not exists source text not null default 'manual';
alter table public.backtests add column if not exists run_group_id uuid;
alter table public.backtests add column if not exists initial_balance numeric;
alter table public.backtests add column if not exists average_rr numeric;

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

create unique index if not exists demo_accounts_user_id_key on public.demo_accounts(user_id);
create unique index if not exists demo_account_settings_user_id_key on public.demo_account_settings(user_id);
create index if not exists demo_orders_user_status_idx on public.demo_orders(user_id, status, opened_at desc);
create index if not exists demo_orders_asset_status_idx on public.demo_orders(asset_id, status);
create index if not exists backtests_strategy_created_idx on public.backtests(strategy_id, created_at desc);
create index if not exists backtests_run_group_idx on public.backtests(run_group_id);
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

alter table public.demo_accounts enable row level security;
alter table public.demo_account_settings enable row level security;
alter table public.demo_orders enable row level security;
alter table public.strategy_cron_runs enable row level security;

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
