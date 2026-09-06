export interface CharlieInsight {
  title: string;
  detail: string;
  priority: 'low' | 'medium' | 'high';
}

export function analyzeLocalOperationsData(): CharlieInsight[] {
  if (typeof localStorage === 'undefined') {
    return [{ title: 'Local data unavailable', detail: 'Charlie cannot read browser storage in this environment.', priority: 'medium' }];
  }

  const keys = Object.keys(localStorage);
  const joined = keys.map((key) => `${key}:${localStorage.getItem(key) || ''}`).join(' ').toLowerCase();
  const insights: CharlieInsight[] = [];

  const patterns = [
    { key: 'access', title: 'Access issue pattern', words: ['access', 'gate', 'locked', 'no access'] },
    { key: '811', title: '811 / locate pattern', words: ['811', 'locate', 'utility'] },
    { key: 'missile', title: 'Missile / bore pattern', words: ['missile', 'bore', 'underground'] },
    { key: 'material', title: 'Material issue pattern', words: ['material', 'conduit', 'drop', 'cable'] },
    { key: 'customer', title: 'Customer absent pattern', words: ['absent', 'not home', 'no answer'] },
  ];

  patterns.forEach((pattern) => {
    const hits = pattern.words.reduce((count, word) => count + (joined.includes(word) ? 1 : 0), 0);
    if (hits > 0) {
      insights.push({
        title: pattern.title,
        detail: `Charlie detected ${hits} local signal(s). Review these jobs before building tomorrow's route.`,
        priority: hits >= 2 ? 'high' : 'medium',
      });
    }
  });

  if (insights.length === 0) {
    insights.push({
      title: 'Charlie is active',
      detail: 'No strong local problem-job pattern detected yet. As routes, not-done notes and history load, Charlie will surface patterns here.',
      priority: 'low',
    });
  }

  return insights;
}

export default function CharlieAIWidget() {
  const insights = analyzeLocalOperationsData();

  return (
    <aside style={{ padding: 16, borderRadius: 16, background: '#0f172a', color: '#fff', maxWidth: 440 }}>
      <h2 style={{ marginTop: 0 }}>🤖 Charlie AI</h2>
      <p style={{ color: '#cbd5e1' }}>Local operations assistant for Not Done, pending jobs, 811, access issues, materials and recovery strategy.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {insights.map((insight) => (
          <div key={insight.title} style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.08)' }}>
            <strong>{insight.title}</strong>
            <div style={{ color: '#cbd5e1', marginTop: 4 }}>{insight.detail}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
