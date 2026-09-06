export type NoteType = 'recommendation' | 'mandatory' | 'urgent';

export interface TechNote {
  id?: string;
  tech_id: string;
  tech_name: string;
  content: string;
  date: string;
  region: string;
  created_at?: string;
}

export interface SupervisorNote {
  id?: string;
  type: NoteType;
  content: string;
  tech_id?: string;
  date: string;
  region: string;
  created_at?: string;
}
