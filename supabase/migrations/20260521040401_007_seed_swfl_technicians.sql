/*
  # Seed SWFL Technicians

  ## Changes
  - Inserts 10 SW Florida technicians with region = 'swfl'
  - IDs 9001–9010
  - Names are placeholders — update with real names/IDs when available
  - All start with pin = NULL (supervisor must assign PINs via the app)

  ## Notes
  - These techs will appear in the SWFL supervisor portal
  - Tech login will show "PIN no asignado" until supervisor assigns a PIN
  - Update names and IDs to match real Comcast tech IDs when known
*/

INSERT INTO technicians (id, name, region, active)
VALUES
  ('9001','Carlos Mendez','swfl',true),
  ('9002','Luis Fernandez','swfl',true),
  ('9003','Roberto Diaz','swfl',true),
  ('9004','Jose Martinez','swfl',true),
  ('9005','Miguel Reyes','swfl',true),
  ('9006','Andres Torres','swfl',true),
  ('9007','Eduardo Vargas','swfl',true),
  ('9008','Francisco Morales','swfl',true),
  ('9009','Hector Castillo','swfl',true),
  ('9010','Ramon Guerrero','swfl',true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  active = EXCLUDED.active;
