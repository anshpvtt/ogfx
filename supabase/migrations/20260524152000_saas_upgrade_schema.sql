-- OGFX SaaS upgrade: additive schema only. Keeps existing runtime tables intact.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists subscription_tier text not null default 'free',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists demo_balance numeric not null default 10000,
  add column if not exists demo_equity numeric not null default 10000,
  add column if not exists risk_percent numeric not null default 1,
  add column if not exists preferred_pairs text[] not null default array['XAUUSD','EURUSD'],
  add column if not exists trading_experience text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.user_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  file_url text,
  raw_text text,
  chunks jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  strategy_context_used text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.signals
  add column if not exists setup_type text,
  add column if not exists reasoning text,
  add column if not exists checklist jsonb not null default '[]'::jsonb,
  add column if not exists gemma_analysis text,
  add column if not exists strategy_alignment text,
  add column if not exists chart_snapshot_url text,
  add column if not exists rr_ratio numeric,
  add column if not exists risk_reward numeric,
  add column if not exists updated_at timestamptz not null default now();

alter table public.demo_orders
  add column if not exists pair text,
  add column if not exists direction text,
  add column if not exists entry_price numeric,
  add column if not exists open_price numeric,
  add column if not exists close_price numeric,
  add column if not exists lot_size numeric not null default 1,
  add column if not exists signal_id uuid references public.signals(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.demo_orders
set
  pair = coalesce(pair, asset_id),
  direction = coalesce(direction, side),
  entry_price = coalesce(entry_price, entry),
  open_price = coalesce(open_price, entry),
  lot_size = coalesce(lot_size, size, 1)
where pair is null
   or direction is null
   or entry_price is null
   or open_price is null
   or lot_size is null;

alter table public.demo_account_settings
  add column if not exists balance numeric not null default 10000,
  add column if not exists equity numeric not null default 10000,
  add column if not exists margin numeric not null default 0,
  add column if not exists free_margin numeric not null default 10000,
  add column if not exists margin_level numeric,
  add column if not exists leverage integer not null default 100,
  add column if not exists currency text not null default 'USD';

alter table public.backtest_runs
  add column if not exists pair text,
  add column if not exists date_from date,
  add column if not exists date_to date,
  add column if not exists total_pnl numeric,
  add column if not exists sharpe_ratio numeric,
  add column if not exists results jsonb;

update public.backtest_runs
set
  pair = coalesce(pair, symbol),
  date_from = coalesce(date_from, start_date),
  date_to = coalesce(date_to, end_date),
  results = coalesce(results, result_json)
where pair is null
   or date_from is null
   or date_to is null
   or results is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('strategies', 'strategies', false, 10485760, array['application/pdf']),
  ('chart-snapshots', 'chart-snapshots', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.profiles enable row level security;
alter table public.user_strategies enable row level security;
alter table public.signals enable row level security;
alter table public.demo_orders enable row level security;
alter table public.demo_account_settings enable row level security;
alter table public.backtest_runs enable row level security;
alter table public.ai_conversations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_own_data') then
    create policy profiles_own_data on public.profiles
      for all to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_strategies' and policyname = 'user_strategies_own_data') then
    create policy user_strategies_own_data on public.user_strategies
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'signals' and policyname = 'signals_own_data') then
    create policy signals_own_data on public.signals
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_orders' and policyname = 'demo_orders_own_data') then
    create policy demo_orders_own_data on public.demo_orders
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_account_settings' and policyname = 'demo_account_settings_own_data') then
    create policy demo_account_settings_own_data on public.demo_account_settings
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'backtest_runs' and policyname = 'backtest_runs_own_data') then
    create policy backtest_runs_own_data on public.backtest_runs
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_conversations' and policyname = 'ai_conversations_own_data') then
    create policy ai_conversations_own_data on public.ai_conversations
      for all to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'strategies_user_folder_select') then
    create policy strategies_user_folder_select on storage.objects
      for select to authenticated
      using (bucket_id = 'strategies' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'strategies_user_folder_insert') then
    create policy strategies_user_folder_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'strategies' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'strategies_user_folder_update') then
    create policy strategies_user_folder_update on storage.objects
      for update to authenticated
      using (bucket_id = 'strategies' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'strategies' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'strategies_user_folder_delete') then
    create policy strategies_user_folder_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'strategies' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chart_snapshots_user_folder_select') then
    create policy chart_snapshots_user_folder_select on storage.objects
      for select to authenticated
      using (bucket_id = 'chart-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chart_snapshots_user_folder_insert') then
    create policy chart_snapshots_user_folder_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'chart-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chart_snapshots_user_folder_update') then
    create policy chart_snapshots_user_folder_update on storage.objects
      for update to authenticated
      using (bucket_id = 'chart-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'chart-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chart_snapshots_user_folder_delete') then
    create policy chart_snapshots_user_folder_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'chart-snapshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
