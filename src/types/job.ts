export type JobStatus = 'pending' | 'done' | 'notdone';

export interface Route {
  id: string;
  date: string;
  tech_id: string;
  job_id: string;
  address: string;
  city?: string;
  phone?: string;
  type?: string;
  status: JobStatus;
  pay_code?: string;
  pay_total?: number;
  job_note?: string;
  zip?: string;
  reason?: string;
  order_num?: number;
  region?: string;
  is_duplicate?: boolean;
  opened_at?: string;
  closed_at?: string;
}

export interface NotDoneReport {
  id?: string;
  date: string;
  tech_id: string;
  tech_name: string;
  job_id: string;
  address: string;
  reason: string;
  notes?: string;
  zone?: string;
  status: 'pending' | 'rescheduled' | 'eod';
  region?: string;
  created_at?: string;
}

export interface CompletedJob {
  id?: string;
  route_id: string;
  tech_id: string;
  tech_name: string;
  job_id: string;
  address: string;
  city?: string;
  phone?: string;
  type?: string;
  pay_code?: string;
  pay_total?: number;
  job_note?: string;
  zip?: string;
  date: string;
  region?: string;
}

export interface CancelledJob {
  id?: string;
  region: string;
  job_id: string;
  address: string;
  city?: string;
  phone?: string;
  type?: string;
  reason: string;
  notes?: string;
  tech_id?: string;
  tech_name?: string;
  source_route_date?: string;
  zone?: string;
  status: 'cancelled' | 'resolved';
  cancelled_at?: string;
}
