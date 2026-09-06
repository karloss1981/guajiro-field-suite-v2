-- ============================================================================
--  MIGRACIÓN FINAL · Rename photo types: before → evidence, after → pht
-- ============================================================================

-- 1) Drop old permissive constraint (if any)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.job_photos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%photo_type%'
  loop
    execute format('alter table public.job_photos drop constraint %I', r.conname);
  end loop;
end $$;

-- 2) Rename existing data
update public.job_photos set photo_type = 'evidence' where photo_type = 'before';
update public.job_photos set photo_type = 'pht'      where photo_type = 'after';

-- 3) Normalization trigger (catches any legacy path still sending before/after)
create or replace function public.tg_normalize_photo_type()
returns trigger language plpgsql as $$
begin
  if new.photo_type = 'before' then new.photo_type := 'evidence';
  elsif new.photo_type = 'after' then new.photo_type := 'pht';
  end if;
  return new;
end $$;

drop trigger if exists trg_normalize_photo_type on public.job_photos;
create trigger trg_normalize_photo_type
  before insert or update of photo_type on public.job_photos
  for each row execute function public.tg_normalize_photo_type();

-- 4) Strict constraint
alter table public.job_photos
  add constraint job_photos_photo_type_final
  check (photo_type in ('evidence', 'pht', 'scan', 'other'));

notify pgrst, 'reload schema';
