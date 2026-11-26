"use client";

import { useState } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { bestValue, canonicalVersion, formatMetric, isBestValue, type Catalog, type Snapshot } from '../lib/results';
import { trackComparison } from '../lib/track-comparison';
import { benchmarkHref } from '../lib/overview';
import { providerColors } from '../lib/presentation';
import type { Language } from '../lib/i18n';
import Insights from './insights';
import InfoTooltip from './info-tooltip';
import { EvaluationReports } from './home';

type Props = {catalog:Catalog; snapshots:Snapshot[]; trackId:string; layer:string; onLayer:(layer:string)=>void; t:(text:string)=>string; language:Language};

export default function TrackResults({catalog,snapshots,trackId,layer,onLayer,t,language}:Props) {
  const comparison = trackComparison(catalog,snapshots,trackId,layer);
  const [sort,setSort] = useState<{id:string;direction:'asc'|'desc'}|null>(null);
  if (!comparison) return <p>{t('No results for this benchmark')}</p>;
  const {columns,rows,profile} = comparison;
  const ordered = sort ? [...rows].sort((a,b)=>{
    const column=columns.find(col=>col.benchmark.id===sort.id);
    if (!column) return 0;
    const left=a.results[sort.id]?.provider.scores[column.metric.id],right=b.results[sort.id]?.provider.scores[column.metric.id];
    return left==null ? right==null?0:1 : right==null?-1 : sort.direction==='asc'?left-right:right-left;
  }):rows;
  const snapshotsForTrack=snapshots.filter(snapshot=>snapshot.benchmarks.some(b=>columns.some(c=>c.benchmark.id===b.id)));
  return <>
    {trackId==='websearch' && <div className="results-controls"><div className="column-views layer-control" role="group" aria-label={t('Output layer')}>
      {['L1','L2','L3'].map((value,index)=><button key={value} aria-pressed={layer===value} onClick={()=>{setSort(null);onLayer(value);}}>{t(['L1 · Search results','L2 · Supplemental text','L3 · Generated answers'][index])}</button>)}
    </div></div>}
    <section id="results" className="leaderboard" aria-label={`${comparison.track.name} ${t('Overview')}`}>
      <div className="table-toolbar"><span className="table-summary">{rows.length} {t('methods')} · {columns.length} {t('benchmarks')}</span></div>
      <div className="table-scroll" style={{'--data-columns':columns.length} as React.CSSProperties} tabIndex={0} role="region" aria-label={t('Results comparison')}>
        <table className="wide-table track-results">
          <caption className="sr-only">{comparison.track.name} {t('Overview')}</caption>
          <colgroup><col className="rank-column"/><col className="provider-column"/>{columns.map(col=><col key={col.benchmark.id}/>)}</colgroup>
          <thead><tr><th className="rank-cell" aria-hidden="true"/><th className="provider-heading" scope="col">{t('Method')}</th>
            {columns.map(col=><th scope="col" key={col.benchmark.id} className={sort?.id===col.benchmark.id?'sorted':undefined} aria-sort={sort?.id===col.benchmark.id?(sort.direction==='asc'?'ascending':'descending'):'none'}>
              <a href={`${benchmarkHref(col.benchmark.id)}&version=${canonicalVersion(col.snapshot.version)}`}>{col.benchmark.name.replace(/^LexBench /,'')} <ArrowUpRight size={11}/></a>
              <div className="metric-heading"><button className="sort-button" onClick={()=>setSort({id:col.benchmark.id,direction:sort?.id===col.benchmark.id&&sort.direction==='desc'?'asc':'desc'})}>{t(col.metric.label)}<ArrowDown size={12} style={{transform:sort?.id===col.benchmark.id&&sort.direction==='asc'?'rotate(180deg)':undefined}}/></button><InfoTooltip label={col.benchmark.name} description={`${canonicalVersion(col.snapshot.version)}. ${t(col.metric.description??'')}`} sources={[{label:t('Evaluation report'),url:col.benchmark.reportUrl}]} sourcesLabel={t('Reports')} detailsLabel={t('details')}/></div>
            </th>)}
          </tr></thead>
          <tbody>{ordered.map(row=><tr key={row.id} data-provider={row.id}><td className="rank-cell" aria-hidden="true"/><td><div className="provider-cell"><a className="provider-name provider-link" href={catalog.providerUrls[Object.values(row.results)[0].provider.id]} target="_blank" rel="noopener noreferrer" aria-label={`${row.name} ${t("project")} (${t("opens in a new tab")})`}><span className="provider-mark" style={{'--provider-color':providerColors[row.id]??'#64748b'} as React.CSSProperties} aria-hidden="true">{row.name[0]}</span><span className="provider-label"><strong>{row.name}</strong></span><ArrowUpRight className="provider-external" size={12}/></a><InfoTooltip label={`${row.name} · ${t('Configurations')}`} description={Object.values(row.results).map(({provider,column})=>`${column.benchmark.name}: ${provider.name}`).join('. ')} detailsLabel={t('details')}/></div></td>
            {columns.map(col=>{
              const measured=row.results[col.benchmark.id];
              const value=measured?.provider.scores[col.metric.id];
              const best=col.benchmark.rankable===false||col.metric.highlightBest===false?null:bestValue(rows.map(row=>row.results[col.benchmark.id]?.provider.scores[col.metric.id]),col.metric.direction);
              const winner=isBestValue(value,best);
              return <td className={`numeric ${winner?'best-value':''}`} key={col.benchmark.id}>{value==null?'—':<a href={`${benchmarkHref(col.benchmark.id)}&version=${canonicalVersion(col.snapshot.version)}&metric=${col.metric.id}`} title={measured.provider.name}>{formatMetric(value,col.metric.unit,col.metric.decimals)}<span className="sr-only"> · {measured.provider.name}</span></a>}{winner&&<span className="sr-only"> {t('Best in this column')}</span>}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <Insights key={`${trackId}:${layer}`} benchmark={profile} t={t} caption="Each axis shows a published quality metric."/>
    <EvaluationReports catalog={catalog} snapshots={snapshotsForTrack} t={t} language={language}/>
  </>;
}
