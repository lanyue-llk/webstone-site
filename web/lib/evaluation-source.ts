import metadata from '../../reports/metadata.json';

export type EvaluationSource = {
  publisher: string;
  origin: 'author' | 'blog' | 'paper' | 'repository' | 'model-card' | 'archive';
  links: {label: string; url: string}[];
};
const evaluations = metadata.evaluations as Record<string, Record<string, EvaluationSource>>;
export function evaluationSource(resultId: string | undefined, providerId: string) {
  if (!resultId) return null;
  return evaluations[resultId]?.[providerId] ?? null;
}
export function evaluationOrigin(source: EvaluationSource) {
  if (source.origin === 'author') return 'Report author’s evaluation';
  if (source.origin === 'blog') return 'Official blog';
  if (source.origin === 'paper') return 'Research paper';
  if (source.origin === 'repository') return 'Public code and results';
  if (source.origin === 'model-card') return 'Model card';
  return 'Published trajectories';
}
