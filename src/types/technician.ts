export interface Technician {
  id: string;
  name: string;
  region: string;
  pin?: string;
  active?: boolean;
}

export interface TechLocation {
  tech_id: string;
  tech_name: string;
  lat: number;
  lng: number;
  updated_at?: string;
}

export interface DailyRouteSnapshot {
  id?: string;
  region: string;
  date: string;
  snapshot: unknown;
  job_count: number;
  done_count: number;
  total_earned: number;
  saved_at?: string;
}

export interface ArchivedRoute {
  id?: string;
  region: string;
  route_date: string;
  job_count: number;
  done_count: number;
  notdone_count: number;
  total_earned: number;
  snapshot: unknown;
}
