create extension if not exists pgcrypto;

create table if not exists public.customer_outreach (
  id uuid primary key default gen_random_uuid(),
  route_id text not null unique,
  job_id text not null,
  tech_id text not null,
  tech_name text,
  region text not null,
  customer_phone text,
  address text,
  original_reason text,
  language text not null default 'en',
  message_body text,
  status text not null default 'queued',
  latest_reply text,
  appointment_date date,
  appointment_window text,
  opted_out_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid references public.customer_outreach(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound')),
  provider text,
  provider_message_id text,
  from_number text,
  to_number text,
  body text not null,
  status text not null default 'queued',
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.customer_replies (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid references public.customer_outreach(id) on delete cascade,
  phone text,
  body text not null,
  detected_language text,
  intent text,
  preferred_date date,
  time_window_start time,
  time_window_end time,
  access_instructions text,
  requires_human_review boolean not null default true,
  ai_result jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid references public.customer_outreach(id) on delete cascade,
  job_id text not null,
  region text not null,
  requested_date date,
  requested_window text,
  access_instructions text,
  status text not null default 'requested',
  created_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_imports (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  route_date date not null,
  filename text,
  uploaded_by text,
  uploaded_by_role text,
  job_count integer not null default 0,
  technician_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'published',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.route_optimization_events (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  region text,
  reason text,
  previous_order jsonb not null default '[]'::jsonb,
  new_order jsonb not null default '[]'::jsonb,
  latitude numeric,
  longitude numeric,
  created_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.technician_breaks (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  region text,
  break_type text not null default 'lunch',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_latitude numeric,
  start_longitude numeric,
  end_latitude numeric,
  end_longitude numeric,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_customer_outreach_region_status on public.customer_outreach(region,status);
create index if not exists idx_customer_outreach_job_id on public.customer_outreach(job_id);
create index if not exists idx_customer_outreach_phone on public.customer_outreach(customer_phone);
create index if not exists idx_customer_messages_outreach on public.customer_messages(outreach_id,created_at desc);
create index if not exists idx_customer_replies_outreach on public.customer_replies(outreach_id,received_at desc);
create index if not exists idx_route_imports_region_date on public.route_imports(region,route_date desc);
create index if not exists idx_route_optimization_tech_date on public.route_optimization_events(tech_id,created_at desc);

alter table public.customer_outreach enable row level security;
alter table public.customer_messages enable row level security;
alter table public.customer_replies enable row level security;
alter table public.appointment_requests enable row level security;
alter table public.route_imports enable row level security;
alter table public.route_optimization_events enable row level security;
alter table public.technician_breaks enable row level security;

-- Compatibility policies for the current PIN-based localhost build.
-- Replace these with authenticated role policies before production deployment.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_outreach' and policyname='customer_outreach_compat') then
    create policy customer_outreach_compat on public.customer_outreach for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_messages' and policyname='customer_messages_compat') then
    create policy customer_messages_compat on public.customer_messages for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_replies' and policyname='customer_replies_compat') then
    create policy customer_replies_compat on public.customer_replies for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='appointment_requests' and policyname='appointment_requests_compat') then
    create policy appointment_requests_compat on public.appointment_requests for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='route_imports' and policyname='route_imports_compat') then
    create policy route_imports_compat on public.route_imports for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='route_optimization_events' and policyname='route_optimization_compat') then
    create policy route_optimization_compat on public.route_optimization_events for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='technician_breaks' and policyname='technician_breaks_compat') then
    create policy technician_breaks_compat on public.technician_breaks for all to anon, authenticated using (true) with check (true);
  end if;
end $$;
