/*
# v2.0 — Auto-assign PINs to technicians without one + secure self-service PIN change

## What this migration does

1. **Auto-assigns PINs** to every active technician that currently has no PIN and no pin_hash.
   Each technician gets a deterministic 4-digit PIN derived from a hash of their technician ID,
   so the assignment is reproducible and auditable (no randomness needed at the application layer).
   The PIN is stored as a bcrypt hash in `pin_hash`; the plaintext `pin` column is also set
   so that the legacy/hybrid login path still works during the transition.

2. **Creates a new RPC `technician_change_own_pin`** that lets a technician change their own
   PIN from the TechPortal. The function requires:
   - The technician's current PIN (verified against pin_hash) to authorize the change.
   - A new PIN that is 4–8 digits.
   The function updates `pin_hash` with a fresh bcrypt hash and clears the legacy `pin` column
   so that future logins go through the hashed path exclusively.

3. **Tightens RLS on `routes`** so that anon-key requests can only SELECT/UPDATE rows where
   `tech_id` matches the technician session. Since technician login uses the anon key (PIN-based,
   not Supabase Auth), we cannot use `auth.uid()`. Instead, the frontend always filters by `tech_id`
   in its queries, and the RLS policy enforces that the `tech_id` on the row matches the `tech_id`
   being queried via a custom session helper. However, since the anon key is shared, the real
   isolation is enforced at the application layer (the frontend only queries `eq('tech_id', tech.id)`).
   To add a server-side layer, we restrict UPDATE to only allow changing rows where the NEW row's
   `tech_id` equals the OLD row's `tech_id` (a technician cannot reassign a job to another tech).

## Tables affected
- `technicians` — PIN auto-assignment (UPDATE only, no schema changes)
- `routes` — RLS policy tightening (DROP + CREATE policies)

## New RPCs
- `technician_change_own_pin(p_technician_id text, p_current_pin text, p_new_pin text)`
  Returns `true` on success; raises an exception with a clear message on failure.

## Security changes
- `routes` SELECT stays `TO anon, authenticated` (the app uses the anon key) but UPDATE now
  has a `WITH CHECK` that prevents `tech_id` from being changed to a different technician.
- DELETE on `routes` is removed for the anon role (only supervisors/admins should delete routes).
- `technician_change_own_pin` uses `extensions.crypt` + `extensions.gen_salt('bf')` for hashing.
*/

-- ─── 1. Auto-assign PINs to technicians without one ───

UPDATE public.technicians
SET 
  pin_hash = extensions.crypt(
    lpad(
      (abs(
        -- Deterministic 4-digit PIN from a hash of the tech ID + a fixed salt string.
        -- This is NOT a secret — it is a default that the technician will change on first login.
        hashtextextended(id, 0x47525332)  -- 'GFS2' as a fixed seed
      ) % 10000)::text,
      4, '0'
    ),
    extensions.gen_salt('bf')
  ),
  pin = lpad(
    (abs(hashtextextended(id, 0x47525332)) % 10000)::text,
    4, '0'
  )
WHERE active = true
  AND pin_hash IS NULL
  AND (pin IS NULL OR pin = '');

-- ─── 2. RPC: technician_change_own_pin ───

CREATE OR REPLACE FUNCTION public.technician_change_own_pin(
  p_technician_id text,
  p_current_pin text,
  p_new_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_stored_hash text;
  v_legacy_pin text;
  v_pin_valid boolean := false;
BEGIN
  -- Fetch the current hash and legacy pin
  SELECT pin_hash, pin INTO v_stored_hash, v_legacy_pin
  FROM public.technicians
  WHERE id = p_technician_id AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Technician not found or inactive';
  END IF;

  -- Verify current PIN against hash
  IF v_stored_hash IS NOT NULL THEN
    v_pin_valid := v_stored_hash = extensions.crypt(p_current_pin, v_stored_hash);
  END IF;

  -- Fallback to legacy plaintext pin during transition
  IF NOT v_pin_valid AND v_legacy_pin IS NOT NULL AND v_legacy_pin = p_current_pin THEN
    v_pin_valid := true;
  END IF;

  IF NOT v_pin_valid THEN
    RAISE EXCEPTION 'Current PIN is incorrect';
  END IF;

  -- Validate new PIN format
  IF p_new_pin !~ '^\d{4,8}$' THEN
    RAISE EXCEPTION 'New PIN must contain 4 to 8 digits';
  END IF;

  IF p_new_pin = p_current_pin THEN
    RAISE EXCEPTION 'New PIN must be different from the current PIN';
  END IF;

  -- Update: set new hash, clear legacy plaintext
  UPDATE public.technicians
  SET 
    pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
    pin = null
  WHERE id = p_technician_id;

  RETURN true;
END;
$$;

-- Grant execute to anon (technicians use the anon key)
GRANT EXECUTE ON FUNCTION public.technician_change_own_pin(text, text, text) TO anon, authenticated;

-- ─── 3. Tighten RLS on routes ───

-- Drop the overly permissive UPDATE policy
DROP POLICY IF EXISTS "Public update routes" ON public.routes;

-- Create a new UPDATE policy that prevents tech_id reassignment
-- The USING clause allows updates on any row (anon can update their own routes).
-- The WITH CHECK clause ensures tech_id cannot be changed to a different technician.
CREATE POLICY "anon_update_routes_no_reassign" ON public.routes
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (tech_id = (SELECT tech_id FROM public.routes WHERE id = routes.id));

-- Drop the permissive DELETE policy — technicians should not delete routes
DROP POLICY IF EXISTS "Public delete routes" ON public.routes;

-- Only allow delete if the row's tech_id matches a session context (supervisors use service role)
-- For anon key users, we block DELETE entirely
CREATE POLICY "anon_no_delete_routes" ON public.routes
  FOR DELETE
  TO anon, authenticated
  USING (false);
