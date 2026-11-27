"use client";

import { useState } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { bestValue, canonicalVersion, formatMetric, isBestValue, type Catalog, type Snapshot } from '../lib/results';
import { coverage, orderComparison, trackComparison, type ComparisonRow } from '../lib/track-comparison';
import { benchmarkHref } from '../lib/overview';
import { providerColors } from '../lib/presentation';
import type { Language } from '../lib/i18n';
import Insights from './insights';
import MethodSelector, {methodColor} from './method-selector';
import InfoTooltip from './info-tooltip';
import MethodDetails from './method-details';
import { EvaluationReports } from './home';

type Props = {catalog:Catalog; snapshots:Snapshot[]; trackId:string; layer:string; onLayer:(layer:string)=>void; t:(text:string)=>string; language:Language};

export default function TrackResults({catalog,snapshots,trackId,layer,onLayer,t,language}:Props) {
  const comparison = trackComparison(catalog,snapshots,trackId,layer);
  const [sort,setSort] = useState<{id:string;direction:'asc'|'desc'}|null>(null);
  const [completeOnly,setCompleteOnly] = useState(false);
  const [chartView,setChartView] = useState('benchmarks');
  const [hidden,setHidden]=useState<string[]>([]);
  const [selected,setSelected] = useState<ComparisonRow|null>(null);
  if (!comparison) return <p>{t('No results for this benchmark')}</p>;
  const {columns,rows,profile} = comparison;
  const sortColumn=columns.find(column=>column.info.id===sort?.id) ?? columns[0];
  const direction=sort?.direction ?? sortColumn.metric.direction;
  const ordered=orderComparison(rows.filter(row=>!completeOnly||coverage(row,columns)===columns.length),sortColumn,direction);
  const complete=ordered.filter(row=>coverage(row,columns)===columns.length);
  const chartRows=ordered.filter(row=>!hidden.includes(row.id));
  const colorMap=Object.fromEntries(rows.map((row,index)=>[row.id,methodColor(index)]));
  const selectedResult=selected && Object.values(selected.results)[0];
  const snapshotsForTrack=snapshots.filter(snapshot=>snapshot.benchmarks.some(b=>columns.some(c=>c.info.id===b.id)));
  return <>
    {trackId==='websearch' && <div className="results-controls"><div className="column-views layer-control" role="group" aria-label={t('Output layer')}>
      {['L1','L2','L3'].map((value,index)=><button key={value} aria-pressed={layer===value} onClick={()=>{setSort(null);onLayer(value);}}>{t(['L1 · Search results','L2 · Supplemental text','L3 · Generated answers'][index])}</button>)}
    </div></div>}
    <nav className="overview-benchmarks" aria-label={t('Included benchmarks')}>
      <span>{t('Included benchmarks')}</span>{columns.map(col=><a key={col.info.id} href={benchmarkHref(col.info.id)}>{col.info.name.replace(/^LexBench /,'')}</a>)}
    </nav>
    <section id="results" className="leaderboard" aria-label={`${comparison.track.name} ${t('Overview')}`}>
      <div className="table-toolbar"><span className="table-summary">{ordered.length} {t('methods')} · {columns.length} {t('benchmarks')}</span>
        <div className="column-views" role="group" aria-label={t('Result coverage')}>
          <button aria-pressed={!completeOnly} onClick={()=>setCompleteOnly(false)}>{t('All methods')}</button>
          <button aria-pressed={completeOnly} onClick={()=>setCompleteOnly(true)}>{t('All benchmarks')}</button>
        </div>
      </div>
      <div className="table-scroll overview-table-scroll" style={{'--data-columns':columns.length} as React.CSSProperties} tabIndex={0} role="region" aria-label={t('Results comparison')}>
        <table className="wide-table track-results">
          <caption className="sr-only">{comparison.track.name} {t('Overview')}</caption>
          <colgroup><col className="provider-column"/>{columns.map(col=><col key={col.info.id}/>)}</colgroup>
          <thead><tr><th className="provider-heading" scope="col">{t('Method')}</th>
            {columns.map(col=><th scope="col" key={col.info.id} className={sortColumn.info.id===col.info.id?'sorted':undefined} aria-sort={sortColumn.info.id===col.info.id?(direction==='asc'?'ascending':'descending'):'none'}>
              <a href={`${benchmarkHref(col.info.id)}${col.snapshot?'&version='+canonicalVersion(col.snapshot.version):''}`}>{col.info.name.replace(/^LexBench /,'')} <ArrowUpRight size={11}/></a>
              <div className="metric-heading"><button className="sort-button" onClick={()=>setSort({id:col.info.id,direction:sortColumn.info.id===col.info.id&&direction==='desc'?'asc':'desc'})}>{t(col.metric.label)}{sortColumn.info.id===col.info.id&&<ArrowDown size={12} style={{transform:direction==='asc'?'rotate(180deg)':undefined}}/>}</button><InfoTooltip label={col.info.name} description={t(col.metric.description??'')} sources={[{label:t('Evaluation report'),url:col.benchmark?.reportUrl??col.info.reportUrl}]} sourcesLabel={t('Reports')} detailsLabel={t('details')}/></div>
              <small className="overview-edition">{col.snapshot?canonicalVersion(col.snapshot.version):t('No published results')}</small>
            </th>)}
          </tr></thead>
          <tbody>{ordered.map(row=><tr key={row.id} data-provider={row.id}><td><div className="provider-cell"><a className="provider-name provider-link" href={catalog.providerUrls[Object.values(row.results)[0].provider.id]} target="_blank" rel="noopener noreferrer" aria-label={`${row.name} ${t('project')} (${t('opens in a new tab')})`}><span className="provider-mark" style={{'--provider-color':providerColors[row.id]??'#64748b'} as React.CSSProperties} aria-hidden="true">{row.name[0]}</span><span className="provider-label"><strong>{row.name}</strong><small className="method-coverage">{coverage(row,columns)}/{columns.length} {t('benchmarks')}</small></span><ArrowUpRight className="provider-external" size={12}/></a><button className="method-open" aria-label={`${row.name} · ${t('Method details')}`} aria-haspopup="dialog" onClick={()=>setSelected(row)}>···</button></div></td>
            {columns.map(col=>{
              const measured=row.results[col.info.id];
              const value=measured?.provider.scores[col.metric.id];
              const best=col.benchmark?.rankable===false||col.metric.highlightBest===false?null:bestValue(ordered.map(row=>row.results[col.info.id]?.provider.scores[col.metric.id]),col.metric.direction);
              const winner=isBestValue(value,best);
              return <td className={`numeric ${winner?'best-value':''}`} key={col.info.id}>{value === null || value === undefined ? '—' :<><a href={`${benchmarkHref(col.info.id)}&version=${canonicalVersion(col.snapshot!.version)}&metric=${col.metric.id}`} title={measured.provider.name}>{formatMetric(value,col.metric.unit,col.metric.decimals)}</a>{measured.provider.name!==row.name&&<small className="measured-configuration">{measured.provider.name}</small>}</>}{winner&&<span className="sr-only"> {t('Best in this column')}</span>}</td>;
            })}
          </tr>)}</tbody>
        </table>
        {ordered.length===0&&<p className="comparison-empty" role="status">{t(completeOnly?'No methods have results for every benchmark.':'No published results')}</p>}
      </div>
    </section>
    <section className="overview-comparisons" aria-label={t('Results comparison')}>
      <div className="column-views overview-chart-controls" role="group" aria-label={t('Chart view')}>
        <button aria-pressed={chartView==='benchmarks'} onClick={()=>setChartView('benchmarks')}>{t('By benchmark')}</button>
        {columns.length>=3&&<button aria-pressed={chartView==='radar'} onClick={()=>setChartView('radar')}>{t('Radar')} · {complete.length} {t('methods')}</button>}
      </div>
      {chartView==='radar'&&columns.length>=3 ? <>{complete.length===0&&<p className="comparison-empty" role="status">{t('No methods have results for every benchmark.')}</p>}<Insights key={`${trackId}:${layer}:radar`} benchmark={{...profile,providers:complete.map(row=>profile.providers.find(p=>p.id===row.id)!),providerCount:complete.length}} t={t} caption="" preserveOrder coverageTotal={columns.length} colors={colorMap} hiddenMethods={hidden} onHiddenChange={setHidden}/></>
        : <div className="overview-chart-layout"><MethodSelector providers={ordered} hidden={hidden} onChange={setHidden} t={t} colors={colorMap} coverage={Object.fromEntries(ordered.map(row=>[row.id,`${coverage(row,columns)}/${columns.length}`]))}/><div className="benchmark-comparisons">{columns.map(col=>{
          const providers=chartRows.flatMap(row=>{const measured=row.results[col.info.id];return typeof measured?.provider.scores[col.metric.id]==='number'?[{...measured.provider,id:row.id,name:row.name}]:[];});
          const benchmark={...profile,id:col.info.id,name:col.info.name,metrics:[col.metric],keyMetricIds:[col.metric.id],primaryMetric:col.metric.id,categories:[],providers,providerCount:providers.length};
          return <div key={col.info.id}>{providers.length ? <Insights benchmark={benchmark} t={t} heading={col.info.name.replace(/^LexBench /,'')} caption="" preserveOrder hideLegend colors={colorMap}/>:<p>{col.info.name}: {t(col.benchmark?.providers.length ? 'Select a method to show its results.' : 'No published results')}</p>}</div>;
        })}</div></div>}
    </section>
    {selectedResult?.column.benchmark&&<MethodDetails provider={selectedResult.provider} benchmark={selectedResult.column.benchmark} catalog={catalog} snapshots={snapshots} showScores={false} t={t} onClose={()=>setSelected(null)}/>}
    <EvaluationReports catalog={catalog} snapshots={snapshotsForTrack} t={t} language={language}/>
  </>;
}
