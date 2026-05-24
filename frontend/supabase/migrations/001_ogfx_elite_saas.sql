create extension if not exists pgcrypto;

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
alter table public.signals add column if not exists confirmation_type text;
alter table public.signals add column if not exists created_at timestamptz default now();

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

update public.signals set signal = 'NO_SETUP' where signal = 'SKIP';
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'signals'
      and column_name = 'symbol'
  ) then
    execute 'update public.signals set pair = coalesce(pair, symbol, ''EURUSD'') where pair is null';
  end if;
end $$;

update public.signals set pair = coalesce(pair, 'EURUSD') where pair is null;
update public.signals set timeframe = coalesce(timeframe, '1H') where timeframe is null;

alter table public.signals alter column pair set not null;
alter table public.signals alter column timeframe set not null;
alter table public.signals add constraint signals_signal_check check (signal in ('BUY', 'SELL', 'NO_SETUP'));

create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  pair text not null,
  timeframe text not null,
  start_date date,
  end_date date,
  total_trades int,
  win_rate numeric,
  profit_factor numeric,
  max_drawdown numeric,
  final_balance numeric,
  sharpe_ratio numeric,
  equity_curve jsonb,
  trade_log jsonb,
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

create unique index if not exists subscriptions_user_id_key on public.subscriptions(user_id);
create index if not exists signals_user_created_idx on public.signals(user_id, created_at desc);
create index if not exists backtests_user_created_idx on public.backtests(user_id, created_at desc);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);

alter table public.signals enable row level security;
alter table public.backtests enable row level security;
alter table public.subscriptions enable row level security;

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

do $$
begin
  alter publication supabase_realtime add table public.signals;
exception
  when duplicate_object then null;
end $$;
