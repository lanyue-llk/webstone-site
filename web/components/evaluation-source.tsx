import { evaluationSource, evaluationOrigin, type EvaluationSource as Source } from '../lib/evaluation-source';

export default function EvaluationSource({source, t}: {source: Source; t: (text: string) => string}) {
  return <section className="evaluation-source" aria-label={t('Evaluation source')}>
    <h3>{t('Evaluation source')}</h3>
    <p>{source.publisher} · {t(evaluationOrigin(source))}</p>
    <ul>{source.links.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{t(link.label)}</a></li>)}</ul>
  </section>;
}

export function EvaluationOrigin({resultId, providerId, t}: {resultId?: string; providerId: string; t: (text: string) => string}) {
  const source = evaluationSource(resultId, providerId);
  if (!source) return null;
  return <small className="evaluation-source-label">{t(evaluationOrigin(source))}</small>;
}
