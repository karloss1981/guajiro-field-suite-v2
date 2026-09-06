/*
  # Seed technician data

  Inserts sample technicians referenced in the login screen.
*/

INSERT INTO technicians (id, name) VALUES
  ('6017', 'Rayner Hernandez Perez'),
  ('6053', 'Jorge Luis Plana'),
  ('7045', 'Adalberto Plana'),
  ('7065', 'Michael'),
  ('7102', 'Yandy Gonzalez'),
  ('7111', 'Yandy Gonzalez (Barroso)'),
  ('7113', 'Vladimir Pujol'),
  ('7163', 'Alberto Amaya'),
  ('7164', 'Omar'),
  ('7191', 'Wilfredo'),
  ('7235', 'Bernal'),
  ('7260', 'Anier Borroto Villar'),
  ('7270', 'Julito'),
  ('7272', 'Renier Alejandro'),
  ('7419', 'Juan Guillermo'),
  ('7570', 'Maikel Sanchez'),
  ('8723', 'Onil'),
  ('8799', 'Michel'),
  ('8804', 'Yunior Barba'),
  ('8807', 'Idan Caballero (Papin)')
ON CONFLICT (id) DO NOTHING;
