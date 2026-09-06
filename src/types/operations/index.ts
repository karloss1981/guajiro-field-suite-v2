export type DispatchRule = {
  id: string;
  region?: string | null;
  service_type?: string | null;
  technician_id?: string | null;
  specialty?: string | null;
  priority: number;
  active: boolean;
};

export type QAReview = {
  id: string;
  job_id?: string | null;
  route_id?: string | null;
  reviewer_id?: string | null;
  score: number;
  passed: boolean;
  comments?: string | null;
  checklist?: Record<string, unknown>;
  reviewed_at?: string;
};

export type Rework = {
  id: string;
  original_job_id?: string | null;
  route_id?: string | null;
  reason: string;
  assigned_to?: string | null;
  resolved: boolean;
  resolution_notes?: string | null;
  resolved_at?: string | null;
};

export type Customer = {
  id: string;
  account_number?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  notes?: string | null;
};

export type MapMarker = {
  id: string;
  job_id?: string | null;
  route_id?: string | null;
  technician_id?: string | null;
  lat: number;
  lng: number;
  marker_type: 'Job' | 'Technician' | 'Warehouse' | 'Fiber Node' | 'Pedestal' | string;
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export type DocumentRecord = {
  id: string;
  name: string;
  category: 'Safety' | 'Procedures' | 'Fiber Standards' | 'Construction Specs' | 'Training' | 'Permits' | string;
  file_url: string;
  cache_offline: boolean;
};

export type TrainingCourse = {
  id: string;
  title: string;
  description?: string | null;
  active: boolean;
};

export type Vehicle = {
  id: string;
  unit_number?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  plate?: string | null;
  assigned_to?: string | null;
  active: boolean;
};

export type Announcement = {
  id: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical' | string;
  active: boolean;
};
