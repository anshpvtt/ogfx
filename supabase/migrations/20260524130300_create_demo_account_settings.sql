create table if not exists public.demo_account_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auto_trading_enabled boolean not null default false,
  risk_per_trade numeric not null default 0.01 check (risk_per_trade >= 0.001 and risk_per_trade <= 0.05),
  max_open_trades integer not null default 5 check (max_open_trades >= 1 and max_open_trades <= 25),
  default_size numeric not null default 1 check (default_size > 0 and default_size <= 100000),
  watched_assets text[] not null default array['XAUUSD','EURUSD','GBPUSD','USDJPY','BTCUSD'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demo_account_settings_user_id_key
  on public.demo_account_settings(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_demo_account_settings_updated_at on public.demo_account_settings;
create trigger set_demo_account_settings_updated_at
  before update on public.demo_account_settings
  for each row execute function public.set_updated_at();

alter table public.demo_account_settings enable row level security;

grant select, insert, update, delete on public.demo_account_settings to authenticated;
grant select, insert, update, delete on public.demo_account_settings to service_role;

drop policy if exists "Users can read own demo settings" on public.demo_account_settings;
drop policy if exists "Users can insert own demo settings" on public.demo_account_settings;
drop policy if exists "Users can update own demo settings" on public.demo_account_settings;
drop policy if exists "Service role full access to demo settings" on public.demo_account_settings;

create policy "Users can read own demo settings"
  on public.demo_account_settings for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can insert own demo settings"
  on public.demo_account_settings for insert
  to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can update own demo settings"
  on public.demo_account_settings for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Service role full access to demo settings"
  on public.demo_account_settings for all
  to service_role
  using (true)
  with check (true);
