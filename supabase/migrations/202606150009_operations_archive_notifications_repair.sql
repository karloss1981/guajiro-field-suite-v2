-- Guajiro Field Operations Suite
-- Repair migration for operations UI, analytics views, and route archive persistence.
-- This migration is idempotent and is intended to be applied after 202606150006/007.

create extension if not exists pgcrypto;

alter table public.technicians
  add column if not exists specialties text[] not null default '{}';

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  account_number text,
  name text,
  phone text,
  email text,
  address text,
  city text,
  state text default 'FL',
  zip_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_account_number on public.customers(account_number);
create index if not exists idx_customers_phone on public.customers(phone);

alter table public.routes add column if not exists customer_id uuid;

-- v8 dispatch temporarily wrote status='assigned', but the technician portal only
-- treats pending as an actionable assigned job. Normalize existing rows safely.
update public.routes
set status = 'pending'
where lower(coalesce(status, '')) = 'assigned';

create table if not exists public.dispatch_rules (
  id uuid primary key default gen_random_uuid(),
  region text,
  service_type text,
  technician_id text,
  specialty text,
  priority integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_dispatch_rules_region_service on public.dispatch_rules(region, service_type);

create table if not exists public.qa_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id text,
  route_id uuid,
  reviewer_id uuid,
  score integer check (score between 0 and 100),
  passed boolean,
  comments text,
  checklist jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.qa_reviews alter column job_id type text using job_id::text;
create index if not exists idx_qa_reviews_route_id on public.qa_reviews(route_id);
create index if not exists idx_qa_reviews_passed on public.qa_reviews(passed);

create table if not exists public.reworks (
  id uuid primary key default gen_random_uuid(),
  original_job_id text,
  route_id uuid,
  reason text not null,
  assigned_to text,
  resolved boolean not null default false,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reworks alter column original_job_id type text using original_job_id::text;
create index if not exists idx_reworks_route_id on public.reworks(route_id);
create index if not exists idx_reworks_resolved on public.reworks(resolved);

create table if not exists public.map_markers (
  id uuid primary key default gen_random_uuid(),
  job_id text,
  route_id uuid,
  technician_id text,
  lat numeric,
  lng numeric,
  marker_type text not null,
  title text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.map_markers alter column job_id type text using job_id::text;
create index if not exists idx_map_markers_type on public.map_markers(marker_type);
create index if not exists idx_map_markers_tech on public.map_markers(technician_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  file_url text not null,
  cache_offline boolean not null default false,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_documents_category on public.documents(category);

create table if not exists public.training_courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.training_progress (
  id uuid primary key default gen_random_uuid(),
  technician_id text,
  course_id uuid references public.training_courses(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(technician_id, course_id)
);
create index if not exists idx_training_progress_tech on public.training_progress(technician_id);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_number text unique,
  make text,
  model text,
  year integer,
  plate text,
  assigned_to text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  technician_id text,
  inspection_date date not null default current_date,
  checklist jsonb not null default '{}'::jsonb,
  passed boolean,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_vehicle_inspections_vehicle_date on public.vehicle_inspections(vehicle_id, inspection_date);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null default 'info',
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_announcements_active on public.announcements(active);

create table if not exists public.cancelled_jobs (
  id uuid primary key default gen_random_uuid(),
  region text not null default 'miami',
  job_id text,
  address text,
  city text,
  phone text,
  type text,
  reason text,
  notes text,
  tech_id text,
  tech_name text,
  source_route_date text,
  zone text,
  status text not null default 'cancelled',
  cancelled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_cancelled_jobs_region_status on public.cancelled_jobs(region,status);
create index if not exists idx_cancelled_jobs_route_date on public.cancelled_jobs(source_route_date);
create index if not exists idx_cancelled_jobs_job_id on public.cancelled_jobs(job_id);

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
create index if not exists idx_route_imports_region_date on public.route_imports(region,route_date desc);

create table if not exists public.daily_route_snapshots (
  id uuid primary key default gen_random_uuid(),
  region text not null default '',
  date text not null default '',
  snapshot jsonb not null default '[]'::jsonb,
  job_count integer not null default 0,
  done_count integer not null default 0,
  total_earned numeric not null default 0,
  saved_at timestamptz not null default now()
);
create unique index if not exists daily_route_snapshots_region_date_unique
  on public.daily_route_snapshots(region, date);

create table if not exists public.archived_routes (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  route_date text not null,
  job_count integer not null default 0,
  done_count integer not null default 0,
  notdone_count integer not null default 0,
  total_earned numeric not null default 0,
  snapshot jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now()
);
create index if not exists idx_archived_routes_region_date on public.archived_routes(region, route_date);
create index if not exists idx_archived_routes_archived_at on public.archived_routes(archived_at desc);

-- Rebuild analytics from live routes and archived route snapshots.
-- Dedupe priority: live route > daily snapshot > permanent archive.
create or replace view public.operations_job_facts as
with candidates as (
  select
    r.tech_id::text as technician_id,
    r.date::text as work_day,
    r.job_id::text as job_id,
    r.status::text as status,
    coalesce(r.pay_total, 0)::numeric as pay_total,
    r.id::text as fallback_key,
    3 as source_priority
  from public.routes r

  union all

  select
    coalesce(job->>'tech_id', 'unassigned') as technician_id,
    coalesce(nullif(job->>'date', ''), s.date) as work_day,
    job->>'job_id' as job_id,
    job->>'status' as status,
    case
      when coalesce(job->>'pay_total', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (job->>'pay_total')::numeric
      else 0
    end as pay_total,
    coalesce(job->>'id', md5(job::text)) as fallback_key,
    2 as source_priority
  from public.daily_route_snapshots s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.snapshot) = 'array' then s.snapshot else '[]'::jsonb end
  ) job

  union all

  select
    coalesce(job->>'tech_id', 'unassigned') as technician_id,
    coalesce(nullif(job->>'date', ''), a.route_date) as work_day,
    job->>'job_id' as job_id,
    job->>'status' as status,
    case
      when coalesce(job->>'pay_total', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (job->>'pay_total')::numeric
      else 0
    end as pay_total,
    coalesce(job->>'id', md5(job::text)) as fallback_key,
    1 as source_priority
  from public.archived_routes a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.snapshot) = 'array' then a.snapshot else '[]'::jsonb end
  ) job
), ranked as (
  select
    candidates.*,
    row_number() over (
      partition by lower(coalesce(technician_id, 'unassigned')), coalesce(work_day, ''), lower(coalesce(nullif(job_id, ''), fallback_key))
      order by source_priority desc
    ) as row_rank
  from candidates
)
select technician_id, work_day, job_id, status, pay_total
from ranked
where row_rank = 1;

create or replace view public.daily_production as
select
  technician_id,
  case when work_day ~ '^\d{4}-\d{2}-\d{2}$' then work_day::date else null end as day,
  count(*) filter (where lower(coalesce(status,'')) in ('done','completed')) as jobs_completed,
  count(*) filter (where lower(coalesce(status,'')) in ('notdone','not_done','not_completed','cancelled')) as jobs_not_done,
  count(*) as total_jobs,
  coalesce(sum(pay_total) filter (where lower(coalesce(status,'')) in ('done','completed')), 0) as total_earned
from public.operations_job_facts
group by technician_id, work_day;

create or replace view public.technician_productivity as
select
  technician_id,
  count(*) filter (where lower(coalesce(status,'')) in ('done','completed')) as completed_jobs,
  count(*) filter (where lower(coalesce(status,'')) in ('notdone','not_done','not_completed','cancelled')) as not_done_jobs,
  count(*) as total_jobs,
  coalesce(sum(pay_total) filter (where lower(coalesce(status,'')) in ('done','completed')), 0) as total_earned
from public.operations_job_facts
group by technician_id;

create or replace view public.qa_dashboard as
select
  count(*) as total_reviews,
  count(*) filter (where passed is true) as passed_reviews,
  count(*) filter (where passed is false) as failed_reviews,
  coalesce(round(avg(score), 2), 0) as average_score
from public.qa_reviews;

create or replace view public.rework_dashboard as
select
  count(*) as total_reworks,
  count(*) filter (where resolved is true) as resolved_reworks,
  count(*) filter (where resolved is false) as open_reworks
from public.reworks;

grant select on public.operations_job_facts to anon, authenticated;
grant select on public.daily_production to anon, authenticated;
grant select on public.technician_productivity to anon, authenticated;
grant select on public.qa_dashboard to anon, authenticated;
grant select on public.rework_dashboard to anon, authenticated;

alter table public.customers enable row level security;
alter table public.dispatch_rules enable row level security;
alter table public.qa_reviews enable row level security;
alter table public.reworks enable row level security;
alter table public.map_markers enable row level security;
alter table public.documents enable row level security;
alter table public.training_courses enable row level security;
alter table public.training_progress enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_inspections enable row level security;
alter table public.announcements enable row level security;
alter table public.cancelled_jobs enable row level security;
alter table public.route_imports enable row level security;
alter table public.daily_route_snapshots enable row level security;
alter table public.archived_routes enable row level security;

-- Keep this repair migration runnable even when the auth-foundation migration has not
-- reached the remote project yet. Migration 202606150006 later replaces these fallbacks.
do $$
begin
  if to_regprocedure('public.is_legacy_access_enabled()') is null then
    execute 'create function public.is_legacy_access_enabled() returns boolean language sql stable as ''select true''';
  end if;
  if to_regprocedure('public.can_read_operations()') is null then
    execute 'create function public.can_read_operations() returns boolean language sql stable as ''select false''';
  end if;
  if to_regprocedure('public.can_manage_operations()') is null then
    execute 'create function public.can_manage_operations() returns boolean language sql stable as ''select false''';
  end if;
  if to_regprocedure('public.can_administer()') is null then
    execute 'create function public.can_administer() returns boolean language sql stable as ''select false''';
  end if;
  if to_regprocedure('public.current_technician_id()') is null then
    execute 'create function public.current_technician_id() returns text language sql stable as ''select null::text''';
  end if;
end $$;

-- Remove older permissive policies before creating the staged scoped policies.
drop policy if exists legacy_read_customers on public.customers;
drop policy if exists legacy_manage_customers on public.customers;
drop policy if exists legacy_read_dispatch_rules on public.dispatch_rules;
drop policy if exists legacy_manage_dispatch_rules on public.dispatch_rules;
drop policy if exists legacy_read_qa_reviews on public.qa_reviews;
drop policy if exists legacy_manage_qa_reviews on public.qa_reviews;
drop policy if exists legacy_read_reworks on public.reworks;
drop policy if exists legacy_manage_reworks on public.reworks;
drop policy if exists legacy_read_documents on public.documents;
drop policy if exists legacy_manage_documents on public.documents;
drop policy if exists legacy_read_training_courses on public.training_courses;
drop policy if exists legacy_manage_training_courses on public.training_courses;
drop policy if exists legacy_read_training_progress on public.training_progress;
drop policy if exists legacy_manage_training_progress on public.training_progress;
drop policy if exists legacy_read_vehicles on public.vehicles;
drop policy if exists legacy_manage_vehicles on public.vehicles;
drop policy if exists legacy_read_vehicle_inspections on public.vehicle_inspections;
drop policy if exists legacy_manage_vehicle_inspections on public.vehicle_inspections;
drop policy if exists legacy_read_announcements on public.announcements;
drop policy if exists legacy_manage_announcements on public.announcements;
drop policy if exists "Anyone authenticated can insert snapshots" on public.daily_route_snapshots;
drop policy if exists "Anyone authenticated can read snapshots" on public.daily_route_snapshots;
drop policy if exists "Anyone authenticated can update snapshots" on public.daily_route_snapshots;

-- legacy_access_enabled keeps the current hybrid localhost workflow operational.
drop policy if exists customers_select_scoped on public.customers;
create policy customers_select_scoped on public.customers for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists customers_manage_scoped on public.customers;
create policy customers_manage_scoped on public.customers for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists dispatch_rules_select_scoped on public.dispatch_rules;
create policy dispatch_rules_select_scoped on public.dispatch_rules for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists dispatch_rules_manage_scoped on public.dispatch_rules;
create policy dispatch_rules_manage_scoped on public.dispatch_rules for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists qa_reviews_select_scoped on public.qa_reviews;
create policy qa_reviews_select_scoped on public.qa_reviews for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists qa_reviews_manage_scoped on public.qa_reviews;
create policy qa_reviews_manage_scoped on public.qa_reviews for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists reworks_select_scoped on public.reworks;
create policy reworks_select_scoped on public.reworks for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists reworks_manage_scoped on public.reworks;
create policy reworks_manage_scoped on public.reworks for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists legacy_read_map_markers on public.map_markers;
drop policy if exists legacy_manage_map_markers on public.map_markers;
drop policy if exists markers_select_scoped on public.map_markers;
create policy markers_select_scoped on public.map_markers for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or technician_id = public.current_technician_id());
drop policy if exists markers_manage_scoped on public.map_markers;
create policy markers_manage_scoped on public.map_markers for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id());

drop policy if exists documents_select_scoped on public.documents;
create policy documents_select_scoped on public.documents for select to anon, authenticated
using (public.is_legacy_access_enabled() or auth.uid() is not null);
drop policy if exists documents_manage_scoped on public.documents;
create policy documents_manage_scoped on public.documents for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists training_courses_select_scoped on public.training_courses;
create policy training_courses_select_scoped on public.training_courses for select to anon, authenticated
using (public.is_legacy_access_enabled() or auth.uid() is not null);
drop policy if exists training_courses_manage_scoped on public.training_courses;
create policy training_courses_manage_scoped on public.training_courses for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists training_progress_select_scoped on public.training_progress;
create policy training_progress_select_scoped on public.training_progress for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or technician_id = public.current_technician_id());
drop policy if exists training_progress_manage_scoped on public.training_progress;
create policy training_progress_manage_scoped on public.training_progress for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id());

drop policy if exists vehicles_select_scoped on public.vehicles;
create policy vehicles_select_scoped on public.vehicles for select to anon, authenticated
using (public.is_legacy_access_enabled() or auth.uid() is not null);
drop policy if exists vehicles_manage_scoped on public.vehicles;
create policy vehicles_manage_scoped on public.vehicles for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists inspections_select_scoped on public.vehicle_inspections;
create policy inspections_select_scoped on public.vehicle_inspections for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or technician_id = public.current_technician_id());
drop policy if exists inspections_manage_scoped on public.vehicle_inspections;
create policy inspections_manage_scoped on public.vehicle_inspections for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or technician_id = public.current_technician_id());

drop policy if exists announcements_select_scoped on public.announcements;
create policy announcements_select_scoped on public.announcements for select to anon, authenticated
using (public.is_legacy_access_enabled() or auth.uid() is not null);
drop policy if exists announcements_manage_scoped on public.announcements;
create policy announcements_manage_scoped on public.announcements for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists cancelled_jobs_select_scoped on public.cancelled_jobs;
create policy cancelled_jobs_select_scoped on public.cancelled_jobs for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists cancelled_jobs_manage_scoped on public.cancelled_jobs;
create policy cancelled_jobs_manage_scoped on public.cancelled_jobs for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists route_imports_select_scoped on public.route_imports;
create policy route_imports_select_scoped on public.route_imports for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists route_imports_manage_scoped on public.route_imports;
create policy route_imports_manage_scoped on public.route_imports for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists snapshots_select_scoped on public.daily_route_snapshots;
create policy snapshots_select_scoped on public.daily_route_snapshots for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists snapshots_insert_scoped on public.daily_route_snapshots;
create policy snapshots_insert_scoped on public.daily_route_snapshots for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists snapshots_update_scoped on public.daily_route_snapshots;
create policy snapshots_update_scoped on public.daily_route_snapshots for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists snapshots_delete_scoped on public.daily_route_snapshots;
create policy snapshots_delete_scoped on public.daily_route_snapshots for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer());

drop policy if exists archived_routes_select_scoped on public.archived_routes;
create policy archived_routes_select_scoped on public.archived_routes for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists archived_routes_insert_scoped on public.archived_routes;
create policy archived_routes_insert_scoped on public.archived_routes for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists archived_routes_delete_scoped on public.archived_routes;
create policy archived_routes_delete_scoped on public.archived_routes for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer());

-- Ask Supabase PostgREST to refresh its schema cache immediately.
notify pgrst, 'reload schema';
