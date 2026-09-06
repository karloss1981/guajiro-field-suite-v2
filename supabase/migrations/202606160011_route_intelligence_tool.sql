-- Route Intelligence Tool: nightly route drafts built from the persistent Not Done pool.
create table if not exists public.rit_route_drafts (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  route_date text not null,
  name text not null default 'Recovery route',
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  job_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by text,
  published_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.rit_route_draft_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.rit_route_drafts(id) on delete cascade,
  pool_id uuid references public.not_done_pool(id) on delete set null,
  job_id text not null,
  technician_id text,
  route_order integer not null default 0,
  priority_score integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_rit_drafts_region_date on public.rit_route_drafts(region,route_date,created_at desc);
create index if not exists idx_rit_items_draft on public.rit_route_draft_items(draft_id,route_order);
alter table public.rit_route_drafts enable row level security;
alter table public.rit_route_draft_items enable row level security;
drop policy if exists rit_drafts_manage_scoped on public.rit_route_drafts;
create policy rit_drafts_manage_scoped on public.rit_route_drafts for all to anon, authenticated using (public.is_legacy_access_enabled() or public.can_manage_operations()) with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists rit_items_manage_scoped on public.rit_route_draft_items;
create policy rit_items_manage_scoped on public.rit_route_draft_items for all to anon, authenticated using (public.is_legacy_access_enabled() or public.can_manage_operations()) with check (public.is_legacy_access_enabled() or public.can_manage_operations());
