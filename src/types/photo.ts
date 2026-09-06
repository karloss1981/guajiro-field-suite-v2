export type PhotoType = 'evidence' | 'pht' | 'before' | 'after';

export interface JobPhoto {
  id?: string;
  route_id: string;
  tech_id: string;
  job_id: string;
  photo_url: string;
  note?: string;
  photo_type?: PhotoType;
  created_at?: string;
}
