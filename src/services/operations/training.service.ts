import { sb } from '../../config/supabase';

export async function getTrainingCourses(includeInactive = false) {
  let query = sb.from('training_courses').select('*').order('title');
  if (!includeInactive) query = query.eq('active', true);
  return query;
}

export async function createTrainingCourse(input: { title: string; description?: string }) {
  return sb.from('training_courses').insert({ ...input, active: true }).select().single();
}

export async function deactivateTrainingCourse(id: string) {
  return sb.from('training_courses').update({ active: false }).eq('id', id);
}

export async function markCourseComplete(technicianId: string, courseId: string) {
  return sb.from('training_progress').upsert({
    technician_id: technicianId,
    course_id: courseId,
    completed: true,
    completed_at: new Date().toISOString(),
  }, { onConflict: 'technician_id,course_id' });
}

export async function getTrainingProgress(technicianId?: string) {
  let query = sb.from('training_progress').select('*, training_courses(*)').order('created_at', { ascending: false });
  if (technicianId) query = query.eq('technician_id', technicianId);
  return query;
}
