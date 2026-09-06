-- Persistent Not Done / Past Pending pool with immutable resolution history.
create table if not exists public.not_done_pool (
  id uuid primary key default gen_random_uuid(),
  region text not null default 'miami',
  job_id text not null,
  address text,
  city text,
  zip text,
  phone text,
  work_type text,
  original_reason text,
  latest_reason text,
  latest_notes text,
  first_not_done_date date not null default current_date,
  last_not_done_date date not null default current_date,
  last_seen_route_date date,
  scheduled_route_date date,
  source_technician_id text,
  latest_technician_id text,
  occurrence_count integer not null default 1,
  current_status text not null default 'open' check (current_status in ('open','scheduled','resolved','cancelled')),
  resolution_type text,
  resolution_notes text,
  resolved_job_date date,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(region, job_id)
);

create index if not exists idx_not_done_pool_region_status on public.not_done_pool(region,current_status);
create index if not exists idx_not_done_pool_job_id on public.not_done_pool(job_id);
create index if not exists idx_not_done_pool_first_date on public.not_done_pool(first_not_done_date);

create table if not exists public.not_done_pool_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid references public.not_done_pool(id) on delete cascade,
  region text not null,
  job_id text not null,
  event_type text not null,
  event_date date,
  technician_id text,
  route_date date,
  reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_not_done_pool_events_pool on public.not_done_pool_events(pool_id,created_at desc);
create index if not exists idx_not_done_pool_events_job on public.not_done_pool_events(region,job_id,created_at desc);

alter table public.not_done_pool enable row level security;
alter table public.not_done_pool_events enable row level security;

drop policy if exists not_done_pool_select_scoped on public.not_done_pool;
create policy not_done_pool_select_scoped on public.not_done_pool for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists not_done_pool_manage_scoped on public.not_done_pool;
create policy not_done_pool_manage_scoped on public.not_done_pool for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists not_done_pool_events_select_scoped on public.not_done_pool_events;
create policy not_done_pool_events_select_scoped on public.not_done_pool_events for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists not_done_pool_events_insert_scoped on public.not_done_pool_events;
create policy not_done_pool_events_insert_scoped on public.not_done_pool_events for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

-- Backfill the active pool from historical not-done reports.
insert into public.not_done_pool (
  region, job_id, address, zip, original_reason, latest_reason, latest_notes,
  first_not_done_date, last_not_done_date, source_technician_id, latest_technician_id,
  occurrence_count, current_status, updated_at
)
select
  coalesce(region,'miami'), job_id, max(address), max(zone),
  (array_agg(reason order by created_at asc))[1],
  (array_agg(reason order by created_at desc))[1],
  (array_agg(notes order by created_at desc))[1],
  min(date::date), max(date::date),
  (array_agg(tech_id order by created_at asc))[1],
  (array_agg(tech_id order by created_at desc))[1],
  count(*)::integer, 'open', now()
from public.not_done_reports
where coalesce(job_id,'') <> '' and job_id <> 'EOD-REPORT'
group by coalesce(region,'miami'), job_id
on conflict (region,job_id) do update set
  last_not_done_date=greatest(public.not_done_pool.last_not_done_date,excluded.last_not_done_date),
  latest_reason=excluded.latest_reason,
  latest_notes=excluded.latest_notes,
  occurrence_count=greatest(public.not_done_pool.occurrence_count,excluded.occurrence_count),
  updated_at=now();

-- Anything already present in completed_jobs is historical/resolved, not active.
update public.not_done_pool p
set current_status='resolved', resolution_type='completed', resolved_job_date=c.date::date,
    resolved_at=coalesce(c.created_at,now()), resolution_notes='Backfilled from completed_jobs', updated_at=now()
from (
  select distinct on (region,job_id) region,job_id,date,created_at
  from public.completed_jobs
  where coalesce(job_id,'') <> ''
  order by region,job_id,date desc,created_at desc
) c
where p.region=c.region and p.job_id=c.job_id;
