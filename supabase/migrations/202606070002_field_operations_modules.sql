-- Guajiro Field Suite PWA - Field Operations Modules (Phases 17-27)
-- Dispatch, QA, Reworks, Customers, Maps, Documents, Training, Vehicles, Communications, Analytics foundations.

-- Ensure UUID extension exists
create extension if not exists "pgcrypto";

-- Technician specialties for auto-dispatch
alter table public.technicians
add column if not exists specialties text[] default '{}';

-- Add customer relation to routes/jobs table if present in this project
alter table if exists public.routes
add column if not exists customer_id uuid;

-- Customers
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_customers_account_number on public.customers(account_number);
create index if not exists idx_customers_phone on public.customers(phone);

-- Dispatch rules
create table if not exists public.dispatch_rules (
  id uuid primary key default gen_random_uuid(),
  region text,
  service_type text,
  technician_id text,
  specialty text,
  priority integer default 1,
  active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_dispatch_rules_region_service on public.dispatch_rules(region, service_type);

-- QA reviews
create table if not exists public.qa_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  route_id uuid,
  reviewer_id uuid,
  score integer check (score between 0 and 100),
  passed boolean,
  comments text,
  checklist jsonb default '{}'::jsonb,
  reviewed_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_qa_reviews_route_id on public.qa_reviews(route_id);
create index if not exists idx_qa_reviews_passed on public.qa_reviews(passed);

-- Rework management
create table if not exists public.reworks (
  id uuid primary key default gen_random_uuid(),
  original_job_id uuid,
  route_id uuid,
  reason text not null,
  assigned_to text,
  resolved boolean default false,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_reworks_route_id on public.reworks(route_id);
create index if not exists idx_reworks_resolved on public.reworks(resolved);

-- Operational map markers
create table if not exists public.map_markers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  route_id uuid,
  technician_id text,
  lat numeric,
  lng numeric,
  marker_type text not null,
  title text,
  description text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_map_markers_type on public.map_markers(marker_type);
create index if not exists idx_map_markers_tech on public.map_markers(technician_id);

-- Documents center
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  file_url text not null,
  cache_offline boolean default false,
  uploaded_by uuid,
  uploaded_at timestamptz default now()
);

create index if not exists idx_documents_category on public.documents(category);

-- Training
create table if not exists public.training_courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.training_progress (
  id uuid primary key default gen_random_uuid(),
  technician_id text,
  course_id uuid references public.training_courses(id) on delete cascade,
  completed boolean default false,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique(technician_id, course_id)
);

create index if not exists idx_training_progress_tech on public.training_progress(technician_id);

-- Vehicles and inspections
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_number text unique,
  make text,
  model text,
  year integer,
  plate text,
  assigned_to text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  technician_id text,
  inspection_date date default current_date,
  checklist jsonb default '{}'::jsonb,
  passed boolean,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_vehicle_inspections_vehicle_date on public.vehicle_inspections(vehicle_id, inspection_date);

-- Communications
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text default 'info',
  active boolean default true,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists idx_announcements_active on public.announcements(active);

-- Lightweight analytics views based on existing routes table
create or replace view public.daily_production as
select
  tech_id as technician_id,
  date(coalesce(completed_at, updated_at, created_at)) as day,
  count(*) filter (where status = 'done') as jobs_completed,
  count(*) filter (where status = 'notdone') as jobs_not_done,
  count(*) as total_jobs,
  coalesce(sum(pay_total) filter (where status = 'done'), 0) as total_earned
from public.routes
group by 1,2;

create or replace view public.technician_productivity as
select
  tech_id as technician_id,
  count(*) filter (where status = 'done') as completed_jobs,
  count(*) filter (where status = 'notdone') as not_done_jobs,
  count(*) as total_jobs,
  coalesce(sum(pay_total) filter (where status = 'done'), 0) as total_earned
from public.routes
group by tech_id;

create or replace view public.qa_dashboard as
select
  count(*) as total_reviews,
  count(*) filter (where passed = true) as passed_reviews,
  count(*) filter (where passed = false) as failed_reviews,
  round(avg(score), 2) as average_score
from public.qa_reviews;

create or replace view public.rework_dashboard as
select
  count(*) as total_reworks,
  count(*) filter (where resolved = true) as resolved_reworks,
  count(*) filter (where resolved = false) as open_reworks
from public.reworks;

-- Enable RLS where appropriate. Policies are intentionally permissive for anon-auth legacy compatibility.
-- Tighten after migrating fully to Supabase Auth roles.
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

-- Legacy-compatible policies
drop policy if exists "legacy_read_customers" on public.customers;
create policy "legacy_read_customers" on public.customers for select using (true);
drop policy if exists "legacy_manage_customers" on public.customers;
create policy "legacy_manage_customers" on public.customers for all using (true) with check (true);
drop policy if exists "legacy_read_dispatch_rules" on public.dispatch_rules;
create policy "legacy_read_dispatch_rules" on public.dispatch_rules for select using (true);
drop policy if exists "legacy_manage_dispatch_rules" on public.dispatch_rules;
create policy "legacy_manage_dispatch_rules" on public.dispatch_rules for all using (true) with check (true);
drop policy if exists "legacy_read_qa_reviews" on public.qa_reviews;
create policy "legacy_read_qa_reviews" on public.qa_reviews for select using (true);
drop policy if exists "legacy_manage_qa_reviews" on public.qa_reviews;
create policy "legacy_manage_qa_reviews" on public.qa_reviews for all using (true) with check (true);
drop policy if exists "legacy_read_reworks" on public.reworks;
create policy "legacy_read_reworks" on public.reworks for select using (true);
drop policy if exists "legacy_manage_reworks" on public.reworks;
create policy "legacy_manage_reworks" on public.reworks for all using (true) with check (true);
drop policy if exists "legacy_read_map_markers" on public.map_markers;
create policy "legacy_read_map_markers" on public.map_markers for select using (true);
drop policy if exists "legacy_manage_map_markers" on public.map_markers;
create policy "legacy_manage_map_markers" on public.map_markers for all using (true) with check (true);
drop policy if exists "legacy_read_documents" on public.documents;
create policy "legacy_read_documents" on public.documents for select using (true);
drop policy if exists "legacy_manage_documents" on public.documents;
create policy "legacy_manage_documents" on public.documents for all using (true) with check (true);
drop policy if exists "legacy_read_training_courses" on public.training_courses;
create policy "legacy_read_training_courses" on public.training_courses for select using (true);
drop policy if exists "legacy_manage_training_courses" on public.training_courses;
create policy "legacy_manage_training_courses" on public.training_courses for all using (true) with check (true);
drop policy if exists "legacy_read_training_progress" on public.training_progress;
create policy "legacy_read_training_progress" on public.training_progress for select using (true);
drop policy if exists "legacy_manage_training_progress" on public.training_progress;
create policy "legacy_manage_training_progress" on public.training_progress for all using (true) with check (true);
drop policy if exists "legacy_read_vehicles" on public.vehicles;
create policy "legacy_read_vehicles" on public.vehicles for select using (true);
drop policy if exists "legacy_manage_vehicles" on public.vehicles;
create policy "legacy_manage_vehicles" on public.vehicles for all using (true) with check (true);
drop policy if exists "legacy_read_vehicle_inspections" on public.vehicle_inspections;
create policy "legacy_read_vehicle_inspections" on public.vehicle_inspections for select using (true);
drop policy if exists "legacy_manage_vehicle_inspections" on public.vehicle_inspections;
create policy "legacy_manage_vehicle_inspections" on public.vehicle_inspections for all using (true) with check (true);
drop policy if exists "legacy_read_announcements" on public.announcements;
create policy "legacy_read_announcements" on public.announcements for select using (true);
drop policy if exists "legacy_manage_announcements" on public.announcements;
create policy "legacy_manage_announcements" on public.announcements for all using (true) with check (true);
