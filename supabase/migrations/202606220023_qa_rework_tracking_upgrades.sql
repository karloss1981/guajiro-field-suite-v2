-- Guajiro Field Suite v23.3 - QA / Rework tracking upgrades
-- Safe to run more than once. This improves tracking metadata without breaking current PWA mode.

alter table if exists public.qa_reviews
  add column if not exists region text,
  add column if not exists tech_id text,
  add column if not exists issue_codes text[] not null default '{}',
  add column if not exists job_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists created_by text;

alter table if exists public.reworks
  add column if not exists region text,
  add column if not exists tech_id text,
  add column if not exists priority text not null default 'normal',
  add column if not exists status text not null default 'open',
  add column if not exists due_date date,
  add column if not exists source text not null default 'dispatch_qa',
  add column if not exists job_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists created_by text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_qa_reviews_job_id on public.qa_reviews(job_id);
create index if not exists idx_qa_reviews_region_tech on public.qa_reviews(region, tech_id);
create index if not exists idx_reworks_original_job_id on public.reworks(original_job_id);
create index if not exists idx_reworks_region_tech on public.reworks(region, tech_id);
create index if not exists idx_reworks_status_priority on public.reworks(status, priority);

create or replace view public.rework_control_dashboard as
select
  count(*) as total_reworks,
  count(*) filter (where coalesce(resolved,false) is false) as open_reworks,
  count(*) filter (where coalesce(resolved,false) is true) as resolved_reworks,
  count(*) filter (where priority = 'critical' and coalesce(resolved,false) is false) as critical_open_reworks,
  count(*) filter (where due_date is not null and due_date < current_date and coalesce(resolved,false) is false) as overdue_reworks
from public.reworks;

alter table if exists public.qa_reviews enable row level security;
alter table if exists public.reworks enable row level security;

drop policy if exists qa_reviews_v23_3_select on public.qa_reviews;
create policy qa_reviews_v23_3_select on public.qa_reviews for select to anon, authenticated using (true);

drop policy if exists qa_reviews_v23_3_manage on public.qa_reviews;
create policy qa_reviews_v23_3_manage on public.qa_reviews for all to anon, authenticated using (true) with check (true);

drop policy if exists reworks_v23_3_select on public.reworks;
create policy reworks_v23_3_select on public.reworks for select to anon, authenticated using (true);

drop policy if exists reworks_v23_3_manage on public.reworks;
create policy reworks_v23_3_manage on public.reworks for all to anon, authenticated using (true) with check (true);
