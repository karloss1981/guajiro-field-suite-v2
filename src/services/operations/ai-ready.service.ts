import { getOperationsDashboard } from './analytics.service';

export async function buildSupervisorAIContext() {
  const dashboard = await getOperationsDashboard();
  return {
    generated_at: new Date().toISOString(),
    dashboard,
    suggested_prompts: [
      '¿Qué técnicos tienen menor productividad esta semana?',
      '¿Cuáles trabajos siguen abiertos más de 48 horas?',
      '¿Qué región tiene más retrabajos?',
    ],
  };
}

export async function buildDispatcherAIContext() {
  return {
    generated_at: new Date().toISOString(),
    suggested_prompts: [
      '¿Quién debería recibir el siguiente trabajo?',
      '¿Quién está más cerca?',
      '¿Quién tiene menos carga?',
    ],
  };
}
