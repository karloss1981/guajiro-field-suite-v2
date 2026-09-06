/*
  # Update SWFL Technician List

  Replaces the placeholder SWFL technicians (9001-9010) with the real roster
  of 30 technicians provided by the supervisor.

  1. Removes old placeholder SWFL techs (9001-9010)
  2. Inserts/updates all 30 real SWFL technicians with correct IDs and names
*/

-- Remove old placeholder techs
DELETE FROM technicians WHERE region = 'swfl' AND id IN (
  '9001','9002','9003','9004','9005','9006','9007','9008','9009','9010'
);

-- Upsert real SWFL roster
INSERT INTO technicians (id, name, region, active) VALUES
  ('7004','Antonio Alfonso Lopez','swfl',true),
  ('7006','Marco Del Aguila','swfl',true),
  ('7009','Jose Del Aguila','swfl',true),
  ('7011','Antonio Montero Hernandez','swfl',true),
  ('7112','Maria Angelica Buitrago','swfl',true),
  ('7133','Yadiel Quintero Garcia','swfl',true),
  ('7176','Michael Astrain Subiador','swfl',true),
  ('7225','Cesar E Quinonez','swfl',true),
  ('7234','Lazaro Prada Martinez','swfl',true),
  ('7255','Dianesky S Echavarria H','swfl',true),
  ('7266','Adrian Rengifo Enrique','swfl',true),
  ('7273','Patrick Edward Jr Seymour','swfl',true),
  ('7284','Yasmani Suares','swfl',true),
  ('7318','Wilka Garcia Reyes','swfl',true),
  ('7325','Yuniel Dorvigny D','swfl',true),
  ('7328','Oscar Chacon Jerez','swfl',true),
  ('7348','Daniel Seibert','swfl',true),
  ('7361','Jose Alfredo Aguila Ulloa','swfl',true),
  ('7368','Michel Ontivero Diaz','swfl',true),
  ('7373','Javier Gonzalo Hernandez Ladino','swfl',true),
  ('7374','Pedro Luis Argudin Mojena','swfl',true),
  ('7395','Stephano Diaz Hernandez','swfl',true),
  ('7644','Juan Alberto Trujillo Diaz','swfl',true),
  ('7708','Eloy Suarez Mouriz','swfl',true),
  ('7754','Erick Rodriguez Pasto','swfl',true),
  ('8072','Edey Ladron De Guevara','swfl',true),
  ('8159','Juan Torres Mitjans','swfl',true),
  ('8377','Luis Acosta Valdes','swfl',true),
  ('8405','Maikel Garcia Moreno','swfl',true),
  ('8514','Jose Torres Padron','swfl',true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, region = 'swfl', active = true;
