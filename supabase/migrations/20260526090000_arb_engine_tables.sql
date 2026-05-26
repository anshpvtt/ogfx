create extension if not exists pgcrypto;

create table if not exists public.arb_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_trade_id text not null,
  coin text not null,
  coin_id text,
  buy_exchange text not null,
  sell_exchange text not null,
  buy_price numeric not null,
  sell_price numeric not null,
  size numeric not null,
  capital_used numeric not null,
  gross_spread_pct numeric,
  fees numeric,
  pnl numeric,
  pnl_pct numeric,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  reason text,
  entry_time timestamptz default now(),
  exit_time timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.arb_bot_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  config jsonb not null,
  is_running boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.arb_capital_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  capital numeric not null,
  snapshot_at timestamptz default now()
);

create table if not exists public.arb_exchange_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange_name text not null,
  api_key_encrypted text,
  secret_encrypted text,
  is_active boolean default false,
  created_at timestamptz default now(),
  unique(user_id, exchange_name)
);

create unique index if not exists arb_trades_user_client_trade_key
  on public.arb_trades(user_id, client_trade_id);

create index if not exists arb_trades_user_created_idx
  on public.arb_trades(user_id, created_at desc);

create index if not exists arb_trades_user_status_idx
  on public.arb_trades(user_id, status, created_at desc);

create index if not exists arb_capital_snapshots_user_time_idx
  on public.arb_capital_snapshots(user_id, snapshot_at asc);

alter table public.arb_trades enable row level security;
alter table public.arb_bot_configs enable row level security;
alter table public.arb_capital_snapshots enable row level security;
alter table public.arb_exchange_keys enable row level security;

drop policy if exists "Users own their arb trades" on public.arb_trades;
drop policy if exists "Users own their arb bot config" on public.arb_bot_configs;
drop policy if exists "Users own their arb snapshots" on public.arb_capital_snapshots;
drop policy if exists "Users own their arb keys" on public.arb_exchange_keys;

create policy "Users own their arb trades"
  on public.arb_trades for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users own their arb bot config"
  on public.arb_bot_configs for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users own their arb snapshots"
  on public.arb_capital_snapshots for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users own their arb keys"
  on public.arb_exchange_keys for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Service role full access to arb trades" on public.arb_trades;
drop policy if exists "Service role full access to arb bot config" on public.arb_bot_configs;
drop policy if exists "Service role full access to arb snapshots" on public.arb_capital_snapshots;
drop policy if exists "Service role full access to arb keys" on public.arb_exchange_keys;

create policy "Service role full access to arb trades"
  on public.arb_trades for all to service_role
  using (true)
  with check (true);

create policy "Service role full access to arb bot config"
  on public.arb_bot_configs for all to service_role
  using (true)
  with check (true);

create policy "Service role full access to arb snapshots"
  on public.arb_capital_snapshots for all to service_role
  using (true)
  with check (true);

create policy "Service role full access to arb keys"
  on public.arb_exchange_keys for all to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.arb_trades to authenticated;
grant select, insert, update, delete on public.arb_bot_configs to authenticated;
grant select, insert, update, delete on public.arb_capital_snapshots to authenticated;
grant select, insert, update, delete on public.arb_exchange_keys to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.arb_trades;
exception
  when duplicate_object then null;
end $$;

select pg_notify('pgrst', 'reload schema');
