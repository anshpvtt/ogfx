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

create table if not exists public.demo_accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  balance decimal(15,2) default 10000.00,
  equity decimal(15,2) default 10000.00,
  free_margin decimal(15,2) default 10000.00,
  margin decimal(15,2) default 0.00,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.demo_accounts add column if not exists user_id uuid references auth.users(id);
alter table public.demo_accounts add column if not exists balance decimal(15,2) default 10000.00;
alter table public.demo_accounts add column if not exists equity decimal(15,2) default 10000.00;
alter table public.demo_accounts add column if not exists free_margin decimal(15,2) default 10000.00;
alter table public.demo_accounts add column if not exists margin decimal(15,2) default 0.00;
alter table public.demo_accounts add column if not exists currency text default 'USD';
alter table public.demo_accounts add column if not exists initial_balance decimal(15,2) default 10000.00;
alter table public.demo_accounts add column if not exists margin_level decimal(15,2);
alter table public.demo_accounts add column if not exists realized_pnl decimal(15,2) default 0.00;
alter table public.demo_accounts add column if not exists created_at timestamp with time zone default now();
alter table public.demo_accounts add column if not exists updated_at timestamp with time zone default now();

update public.demo_accounts
set
  balance = coalesce(balance, 10000.00),
  equity = coalesce(equity, balance, 10000.00),
  free_margin = coalesce(free_margin, equity, balance, 10000.00),
  margin = coalesce(margin, 0.00),
  initial_balance = coalesce(initial_balance, balance, 10000.00),
  realized_pnl = coalesce(realized_pnl, 0.00);

create unique index if not exists demo_accounts_user_id_key on public.demo_accounts(user_id);

create table if not exists public.demo_orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  symbol varchar(20) not null,
  direction varchar(4) check (direction in ('BUY', 'SELL')),
  lot_size decimal(10,4) default 1.0,
  entry_price decimal(15,5),
  stop_loss decimal(15,5),
  take_profit decimal(15,5),
  status varchar(20) default 'open',
  pnl decimal(15,2) default 0.00,
  opened_at timestamp with time zone default now(),
  closed_at timestamp with time zone,
  close_price decimal(15,5),
  created_at timestamp with time zone default now()
);

alter table public.demo_orders add column if not exists user_id uuid references auth.users(id);
alter table public.demo_orders add column if not exists symbol varchar(20);
alter table public.demo_orders add column if not exists direction varchar(4);
alter table public.demo_orders add column if not exists lot_size decimal(10,4) default 1.0;
alter table public.demo_orders add column if not exists entry_price decimal(15,5);
alter table public.demo_orders add column if not exists stop_loss decimal(15,5);
alter table public.demo_orders add column if not exists take_profit decimal(15,5);
alter table public.demo_orders add column if not exists status varchar(20) default 'open';
alter table public.demo_orders add column if not exists pnl decimal(15,2) default 0.00;
alter table public.demo_orders add column if not exists opened_at timestamp with time zone default now();
alter table public.demo_orders add column if not exists closed_at timestamp with time zone;
alter table public.demo_orders add column if not exists close_price decimal(15,5);
alter table public.demo_orders add column if not exists created_at timestamp with time zone default now();
alter table public.demo_orders add column if not exists updated_at timestamp with time zone default now();

-- Compatibility with earlier OGFX dashboard columns.
alter table public.demo_orders add column if not exists asset_id text;
alter table public.demo_orders add column if not exists trading_view_symbol text;
alter table public.demo_orders add column if not exists side text;
alter table public.demo_orders add column if not exists entry numeric;
alter table public.demo_orders add column if not exists size numeric;
alter table public.demo_orders add column if not exists source text default 'manual';
alter table public.demo_orders add column if not exists strategy_id text;
alter table public.demo_orders add column if not exists strategy_name text;
alter table public.demo_orders add column if not exists confidence numeric;
alter table public.demo_orders add column if not exists reason text;
alter table public.demo_orders add column if not exists exit_price numeric;

update public.demo_orders
set
  symbol = coalesce(symbol, asset_id, 'XAUUSD'),
  asset_id = coalesce(asset_id, symbol, 'XAUUSD'),
  direction = coalesce(direction, side, 'BUY'),
  side = coalesce(side, direction, 'BUY'),
  lot_size = coalesce(lot_size, size, 1.0),
  size = coalesce(size, lot_size, 1.0),
  entry_price = coalesce(entry_price, entry, 0),
  entry = coalesce(entry, entry_price, 0),
  close_price = coalesce(close_price, exit_price),
  exit_price = coalesce(exit_price, close_price),
  pnl = coalesce(pnl, 0.00),
  status = coalesce(status, 'open');

do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.demo_orders'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%status%'
        or pg_get_constraintdef(oid) ilike '%direction%'
        or pg_get_constraintdef(oid) ilike '%side%'
      )
  loop
    execute format('alter table public.demo_orders drop constraint if exists %I', check_constraint.conname);
  end loop;
end $$;

alter table public.demo_orders alter column symbol set not null;
alter table public.demo_orders alter column asset_id set not null;
alter table public.demo_orders alter column direction set not null;
alter table public.demo_orders alter column side set not null;
alter table public.demo_orders alter column entry set not null;
alter table public.demo_orders alter column size set not null;
alter table public.demo_orders add constraint demo_orders_direction_check check (direction in ('BUY', 'SELL'));
alter table public.demo_orders add constraint demo_orders_side_check check (side in ('BUY', 'SELL'));
alter table public.demo_orders add constraint demo_orders_status_check check (status in ('open', 'pending', 'closed', 'OPEN', 'TP', 'SL', 'CLOSED'));

create index if not exists demo_orders_user_status_idx on public.demo_orders(user_id, status, opened_at desc);
create index if not exists demo_orders_symbol_status_idx on public.demo_orders(symbol, status);
create index if not exists demo_orders_asset_status_idx on public.demo_orders(asset_id, status);

create table if not exists public.signals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  symbol varchar(20) not null,
  direction varchar(4) check (direction in ('BUY', 'SELL')),
  timeframe varchar(10),
  entry decimal(15,5),
  stop_loss decimal(15,5),
  take_profit decimal(15,5),
  rr_ratio decimal(5,2),
  confidence integer default 0,
  strategy varchar(100),
  status varchar(20) default 'active',
  created_at timestamp with time zone default now()
);

alter table public.signals add column if not exists user_id uuid references auth.users(id);
alter table public.signals add column if not exists symbol varchar(20);
alter table public.signals add column if not exists direction varchar(4);
alter table public.signals add column if not exists timeframe varchar(10);
alter table public.signals add column if not exists entry decimal(15,5);
alter table public.signals add column if not exists stop_loss decimal(15,5);
alter table public.signals add column if not exists take_profit decimal(15,5);
alter table public.signals add column if not exists rr_ratio decimal(5,2);
alter table public.signals add column if not exists confidence integer default 0;
alter table public.signals add column if not exists strategy varchar(100);
alter table public.signals add column if not exists status varchar(20) default 'active';
alter table public.signals add column if not exists created_at timestamp with time zone default now();

-- Compatibility with earlier OGFX dashboard columns.
alter table public.signals add column if not exists pair text;
alter table public.signals add column if not exists signal text;
alter table public.signals add column if not exists bias text;
alter table public.signals add column if not exists risk_reward numeric;
alter table public.signals add column if not exists confirmation_type text;
alter table public.signals add column if not exists reason text;
alter table public.signals add column if not exists entry_price numeric;
alter table public.signals add column if not exists strategy_name text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'signals'
      and column_name = 'confidence'
      and data_type <> 'integer'
  ) then
    alter table public.signals alter column confidence type integer using (
      case
        when confidence::text ~ '^[0-9]+(\.[0-9]+)?$' then round(confidence::numeric)::integer
        when upper(confidence::text) = 'HIGH' then 85
        when upper(confidence::text) = 'MEDIUM' then 65
        when upper(confidence::text) = 'LOW' then 35
        else 0
      end
    );
  end if;
end $$;

update public.signals
set
  symbol = coalesce(symbol, pair, 'XAUUSD'),
  pair = coalesce(pair, symbol, 'XAUUSD'),
  direction = coalesce(direction, nullif(nullif(nullif(signal, 'NO_SETUP'), 'SKIP'), 'WAIT')),
  signal = coalesce(signal, direction, 'NO_SETUP'),
  entry = coalesce(entry, entry_price),
  entry_price = coalesce(entry_price, entry),
  rr_ratio = coalesce(rr_ratio, risk_reward),
  risk_reward = coalesce(risk_reward, rr_ratio),
  confidence = coalesce(confidence, 0),
  strategy = coalesce(strategy, strategy_name, 'ELITE_SMC_GEMMA'),
  strategy_name = coalesce(strategy_name, strategy),
  status = coalesce(status, 'active');

update public.signals
set direction = null
where direction is not null
  and direction not in ('BUY', 'SELL');

do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.signals'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%signal%'
        or pg_get_constraintdef(oid) ilike '%direction%'
      )
  loop
    execute format('alter table public.signals drop constraint if exists %I', check_constraint.conname);
  end loop;
end $$;

alter table public.signals alter column symbol set not null;
alter table public.signals alter column confidence set default 0;
alter table public.signals add constraint signals_direction_check check (direction is null or direction in ('BUY', 'SELL'));
alter table public.signals add constraint signals_signal_check check (signal in ('BUY', 'SELL', 'NO_SETUP', 'WAIT', 'SKIP'));

create index if not exists signals_user_created_idx on public.signals(user_id, created_at desc);
create index if not exists signals_symbol_created_idx on public.signals(symbol, created_at desc);
create index if not exists signals_pair_created_idx on public.signals(pair, created_at desc);

create table if not exists public.backtest_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  symbol varchar(20),
  timeframe varchar(10),
  start_date date,
  end_date date,
  total_trades integer default 0,
  win_rate decimal(5,2),
  total_pnl decimal(15,2),
  max_drawdown decimal(15,2),
  result_json jsonb,
  status varchar(20) default 'pending',
  created_at timestamp with time zone default now()
);

create index if not exists backtest_runs_user_created_idx on public.backtest_runs(user_id, created_at desc);
create index if not exists backtest_runs_symbol_created_idx on public.backtest_runs(symbol, created_at desc);

drop trigger if exists set_demo_accounts_updated_at on public.demo_accounts;
create trigger set_demo_accounts_updated_at
  before update on public.demo_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists set_demo_orders_updated_at on public.demo_orders;
create trigger set_demo_orders_updated_at
  before update on public.demo_orders
  for each row execute function public.set_updated_at();

alter table public.demo_accounts enable row level security;
alter table public.demo_orders enable row level security;
alter table public.signals enable row level security;
alter table public.backtest_runs enable row level security;

drop policy if exists "Users can manage own demo account" on public.demo_accounts;
drop policy if exists "Users can manage own orders" on public.demo_orders;
drop policy if exists "Users can manage own signals" on public.signals;
drop policy if exists "Users can manage own backtests" on public.backtest_runs;

create policy "Users can manage own demo account" on public.demo_accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage own orders" on public.demo_orders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage own signals" on public.signals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage own backtests" on public.backtest_runs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.demo_accounts (user_id, balance, equity, free_margin)
  values (new.id, 10000.00, 10000.00, 10000.00)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.signals;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.demo_orders;
exception
  when duplicate_object then null;
end $$;
