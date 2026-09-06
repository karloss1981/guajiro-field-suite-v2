import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = 'https://avbhpazpfgnskgvbopce.supabase.co';
const rawSupabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2YmhwYXpwZmduc2tndmJvcGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5Njc2NjcsImV4cCI6MjA5NDU0MzY2N30.AnowwNTLGIKcP71Qdi93aNB4R0CL8GAWjdjRIJ5RlQk';

export const SUPABASE_CONFIGURED = true;

export const SUPABASE_CONFIG_ERROR = '';

export const sb = createClient(rawSupabaseUrl, rawSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'gfs_supabase_auth',
  },
});

export const SUPABASE_PROJECT_URL = rawSupabaseUrl;
