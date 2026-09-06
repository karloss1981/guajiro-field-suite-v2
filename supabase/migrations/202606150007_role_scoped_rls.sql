-- Staged role-scoped RLS for Guajiro Field Operations Suite.
-- Existing legacy/public policies are replaced with policies that remain permissive
-- only while public.is_legacy_access_enabled() is TRUE. After real accounts and
-- role/profile links are ready, call public.set_legacy_access_enabled(false).

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

alter table public.technicians enable row level security;
drop policy if exists "Public read technicians" on public.technicians;
drop policy if exists "Anyone can read technicians" on public.technicians;
drop policy if exists "Anyone can update technician pin" on public.technicians;
drop policy if exists "Anyone can insert technicians" on public.technicians;
drop policy if exists technicians_select_scoped on public.technicians;
create policy technicians_select_scoped on public.technicians for select to anon, authenticated
using (
  public.is_legacy_access_enabled()
  or public.can_read_operations()
  or id = public.current_technician_id()
);
drop policy if exists technicians_insert_scoped on public.technicians;
create policy technicians_insert_scoped on public.technicians for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_administer());
drop policy if exists technicians_update_scoped on public.technicians;
create policy technicians_update_scoped on public.technicians for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer() or public.has_any_role(array['supervisor']))
with check (public.is_legacy_access_enabled() or public.can_administer() or public.has_any_role(array['supervisor']));
drop policy if exists technicians_delete_scoped on public.technicians;
create policy technicians_delete_scoped on public.technicians for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer());

alter table public.routes enable row level security;
drop policy if exists "Public read routes" on public.routes;
drop policy if exists "Public insert routes" on public.routes;
drop policy if exists "Public update routes" on public.routes;
drop policy if exists "Public delete routes" on public.routes;
drop policy if exists routes_select_scoped on public.routes;
create policy routes_select_scoped on public.routes for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists routes_insert_scoped on public.routes;
create policy routes_insert_scoped on public.routes for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists routes_update_scoped on public.routes;
create policy routes_update_scoped on public.routes for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists routes_delete_scoped on public.routes;
create policy routes_delete_scoped on public.routes for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer());

alter table public.job_photos enable row level security;
drop policy if exists "Public read job_photos" on public.job_photos;
drop policy if exists "Public insert job_photos" on public.job_photos;
drop policy if exists "Public delete job_photos" on public.job_photos;
drop policy if exists job_photos_select_scoped on public.job_photos;
create policy job_photos_select_scoped on public.job_photos for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists job_photos_insert_scoped on public.job_photos;
create policy job_photos_insert_scoped on public.job_photos for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists job_photos_update_scoped on public.job_photos;
create policy job_photos_update_scoped on public.job_photos for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists job_photos_delete_scoped on public.job_photos;
create policy job_photos_delete_scoped on public.job_photos for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

alter table public.supervisor_notes enable row level security;
drop policy if exists "Public read supervisor_notes" on public.supervisor_notes;
drop policy if exists "Public insert supervisor_notes" on public.supervisor_notes;
drop policy if exists supervisor_notes_select_scoped on public.supervisor_notes;
create policy supervisor_notes_select_scoped on public.supervisor_notes for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists supervisor_notes_insert_scoped on public.supervisor_notes;
create policy supervisor_notes_insert_scoped on public.supervisor_notes for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists supervisor_notes_update_scoped on public.supervisor_notes;
create policy supervisor_notes_update_scoped on public.supervisor_notes for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists supervisor_notes_delete_scoped on public.supervisor_notes;
create policy supervisor_notes_delete_scoped on public.supervisor_notes for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations());

alter table public.tech_locations enable row level security;
drop policy if exists "Public read tech_locations" on public.tech_locations;
drop policy if exists "Public insert tech_locations" on public.tech_locations;
drop policy if exists "Public update tech_locations" on public.tech_locations;
drop policy if exists tech_locations_select_scoped on public.tech_locations;
create policy tech_locations_select_scoped on public.tech_locations for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists tech_locations_insert_scoped on public.tech_locations;
create policy tech_locations_insert_scoped on public.tech_locations for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists tech_locations_update_scoped on public.tech_locations;
create policy tech_locations_update_scoped on public.tech_locations for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

alter table public.not_done_reports enable row level security;
drop policy if exists "Public read not_done_reports" on public.not_done_reports;
drop policy if exists "Public insert not_done_reports" on public.not_done_reports;
drop policy if exists "Public update not_done_reports" on public.not_done_reports;
drop policy if exists "Public delete not_done_reports" on public.not_done_reports;
drop policy if exists not_done_select_scoped on public.not_done_reports;
create policy not_done_select_scoped on public.not_done_reports for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists not_done_insert_scoped on public.not_done_reports;
create policy not_done_insert_scoped on public.not_done_reports for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists not_done_update_scoped on public.not_done_reports;
create policy not_done_update_scoped on public.not_done_reports for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists not_done_delete_scoped on public.not_done_reports;
create policy not_done_delete_scoped on public.not_done_reports for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations());

alter table public.tech_notes enable row level security;
drop policy if exists "Authenticated users can insert tech notes" on public.tech_notes;
drop policy if exists "Authenticated users can read tech notes" on public.tech_notes;
drop policy if exists tech_notes_select_scoped on public.tech_notes;
create policy tech_notes_select_scoped on public.tech_notes for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists tech_notes_insert_scoped on public.tech_notes;
create policy tech_notes_insert_scoped on public.tech_notes for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

alter table public.completed_jobs enable row level security;
drop policy if exists "Public read completed_jobs" on public.completed_jobs;
drop policy if exists "Public insert completed_jobs" on public.completed_jobs;
drop policy if exists "Public update completed_jobs" on public.completed_jobs;
drop policy if exists "Public delete completed_jobs" on public.completed_jobs;
drop policy if exists completed_jobs_select_scoped on public.completed_jobs;
create policy completed_jobs_select_scoped on public.completed_jobs for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists completed_jobs_insert_scoped on public.completed_jobs;
create policy completed_jobs_insert_scoped on public.completed_jobs for insert to anon, authenticated
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());
drop policy if exists completed_jobs_update_scoped on public.completed_jobs;
create policy completed_jobs_update_scoped on public.completed_jobs for update to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());
drop policy if exists completed_jobs_delete_scoped on public.completed_jobs;
create policy completed_jobs_delete_scoped on public.completed_jobs for delete to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer());

alter table public.daily_route_snapshots enable row level security;
drop policy if exists "Anyone authenticated can insert snapshots" on public.daily_route_snapshots;
drop policy if exists "Anyone authenticated can read snapshots" on public.daily_route_snapshots;
drop policy if exists "Anyone authenticated can update snapshots" on public.daily_route_snapshots;
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

-- ---------------------------------------------------------------------------
-- Operations modules
-- ---------------------------------------------------------------------------

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

-- Re-drop known legacy policies explicitly because the generic block above uses a single variable name.
drop policy if exists legacy_read_customers on public.customers;
drop policy if exists legacy_manage_customers on public.customers;
drop policy if exists legacy_read_dispatch_rules on public.dispatch_rules;
drop policy if exists legacy_manage_dispatch_rules on public.dispatch_rules;
drop policy if exists legacy_read_qa_reviews on public.qa_reviews;
drop policy if exists legacy_manage_qa_reviews on public.qa_reviews;
drop policy if exists legacy_read_reworks on public.reworks;
drop policy if exists legacy_manage_reworks on public.reworks;
drop policy if exists legacy_read_map_markers on public.map_markers;
drop policy if exists legacy_manage_map_markers on public.map_markers;
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

-- ---------------------------------------------------------------------------
-- Customer recovery and route-control tables. Manual SMS only for this release.
-- ---------------------------------------------------------------------------

create table if not exists public.customer_messaging_settings (
  region text primary key check (region in ('miami','swfl')),
  mode text not null default 'manual_sms' check (mode = 'manual_sms'),
  updated_by text,
  updated_by_role text,
  updated_at timestamptz not null default now()
);
alter table public.customer_messaging_settings enable row level security;
alter table public.customer_messaging_settings drop constraint if exists customer_messaging_settings_mode_check;
alter table public.customer_messaging_settings
  add constraint customer_messaging_settings_mode_check check (mode = 'manual_sms');

-- Drop compatibility policies.
drop policy if exists customer_outreach_compat on public.customer_outreach;
drop policy if exists customer_messages_compat on public.customer_messages;
drop policy if exists customer_replies_compat on public.customer_replies;
drop policy if exists appointment_requests_compat on public.appointment_requests;
drop policy if exists route_imports_compat on public.route_imports;
drop policy if exists route_optimization_compat on public.route_optimization_events;
drop policy if exists technician_breaks_compat on public.technician_breaks;
drop policy if exists customer_messaging_settings_compat on public.customer_messaging_settings;

drop policy if exists outreach_select_scoped on public.customer_outreach;
create policy outreach_select_scoped on public.customer_outreach for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists outreach_manage_scoped on public.customer_outreach;
create policy outreach_manage_scoped on public.customer_outreach for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

drop policy if exists messages_select_scoped on public.customer_messages;
create policy messages_select_scoped on public.customer_messages for select to anon, authenticated
using (
  public.is_legacy_access_enabled()
  or public.can_read_operations()
  or exists (
    select 1 from public.customer_outreach o
    where o.id = customer_messages.outreach_id
      and o.tech_id = public.current_technician_id()
  )
);
drop policy if exists messages_manage_scoped on public.customer_messages;
create policy messages_manage_scoped on public.customer_messages for all to anon, authenticated
using (
  public.is_legacy_access_enabled()
  or public.can_manage_operations()
  or exists (
    select 1 from public.customer_outreach o
    where o.id = customer_messages.outreach_id
      and o.tech_id = public.current_technician_id()
  )
)
with check (
  public.is_legacy_access_enabled()
  or public.can_manage_operations()
  or exists (
    select 1 from public.customer_outreach o
    where o.id = customer_messages.outreach_id
      and o.tech_id = public.current_technician_id()
  )
);

drop policy if exists replies_select_scoped on public.customer_replies;
create policy replies_select_scoped on public.customer_replies for select to anon, authenticated
using (
  public.is_legacy_access_enabled()
  or public.can_read_operations()
  or exists (
    select 1 from public.customer_outreach o
    where o.id = customer_replies.outreach_id
      and o.tech_id = public.current_technician_id()
  )
);
drop policy if exists replies_manage_scoped on public.customer_replies;
create policy replies_manage_scoped on public.customer_replies for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists appointments_select_scoped on public.appointment_requests;
create policy appointments_select_scoped on public.appointment_requests for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists appointments_manage_scoped on public.appointment_requests;
create policy appointments_manage_scoped on public.appointment_requests for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists route_imports_select_scoped on public.route_imports;
create policy route_imports_select_scoped on public.route_imports for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists route_imports_manage_scoped on public.route_imports;
create policy route_imports_manage_scoped on public.route_imports for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations())
with check (public.is_legacy_access_enabled() or public.can_manage_operations());

drop policy if exists route_optimization_select_scoped on public.route_optimization_events;
create policy route_optimization_select_scoped on public.route_optimization_events for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists route_optimization_manage_scoped on public.route_optimization_events;
create policy route_optimization_manage_scoped on public.route_optimization_events for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

drop policy if exists technician_breaks_select_scoped on public.technician_breaks;
create policy technician_breaks_select_scoped on public.technician_breaks for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations() or tech_id = public.current_technician_id());
drop policy if exists technician_breaks_manage_scoped on public.technician_breaks;
create policy technician_breaks_manage_scoped on public.technician_breaks for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id())
with check (public.is_legacy_access_enabled() or public.can_manage_operations() or tech_id = public.current_technician_id());

drop policy if exists messaging_settings_select_scoped on public.customer_messaging_settings;
create policy messaging_settings_select_scoped on public.customer_messaging_settings for select to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_read_operations());
drop policy if exists messaging_settings_manage_scoped on public.customer_messaging_settings;
create policy messaging_settings_manage_scoped on public.customer_messaging_settings for all to anon, authenticated
using (public.is_legacy_access_enabled() or public.can_administer())
with check (public.is_legacy_access_enabled() or public.can_administer());

insert into public.customer_messaging_settings(region, mode)
values ('miami','manual_sms'),('swfl','manual_sms')
on conflict (region) do update set mode='manual_sms';

-- ---------------------------------------------------------------------------
-- Audit: anonymous insert only while legacy mode remains enabled.
-- ---------------------------------------------------------------------------

drop policy if exists audit_insert_anon_legacy_compat on public.audit_logs;
create policy audit_insert_anon_legacy_compat on public.audit_logs
for insert to anon
with check (public.is_legacy_access_enabled() and user_id is null);

-- ---------------------------------------------------------------------------
-- Storage bucket policies (job-photos)
-- ---------------------------------------------------------------------------

drop policy if exists "Allow public uploads" on storage.objects;
drop policy if exists "Allow public reads" on storage.objects;
drop policy if exists "Allow public deletes" on storage.objects;
drop policy if exists "Allow public updates" on storage.objects;

drop policy if exists job_photos_storage_read on storage.objects;
create policy job_photos_storage_read on storage.objects for select to anon, authenticated
using (bucket_id = 'job-photos' and (public.is_legacy_access_enabled() or auth.uid() is not null));
drop policy if exists job_photos_storage_insert on storage.objects;
create policy job_photos_storage_insert on storage.objects for insert to anon, authenticated
with check (bucket_id = 'job-photos' and (public.is_legacy_access_enabled() or auth.uid() is not null));
drop policy if exists job_photos_storage_update on storage.objects;
create policy job_photos_storage_update on storage.objects for update to anon, authenticated
using (bucket_id = 'job-photos' and (public.is_legacy_access_enabled() or auth.uid() is not null))
with check (bucket_id = 'job-photos' and (public.is_legacy_access_enabled() or auth.uid() is not null));
drop policy if exists job_photos_storage_delete on storage.objects;
create policy job_photos_storage_delete on storage.objects for delete to anon, authenticated
using (bucket_id = 'job-photos' and (public.is_legacy_access_enabled() or public.can_manage_operations()));
