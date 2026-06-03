create table if not exists public.monthly_utility_usage (
  id bigint primary key,
  property_id bigint not null,
  tenant_id bigint,
  scope_type text not null default 'building',
  usage_month text not null,
  electricity_kwh numeric not null default 0,
  heating_kwh numeric not null default 0,
  cooling_kwh numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists monthly_utility_usage_natural_key
  on public.monthly_utility_usage (
    property_id,
    coalesce(tenant_id, 0),
    scope_type,
    usage_month
  );

alter table public.monthly_utility_usage enable row level security;

-- The app syncs this table through /api/monthly-usage-sync with the
-- Supabase service role key. Do not add broad public insert/update policies
-- unless the app also gets real user authentication.
