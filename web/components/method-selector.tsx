"use client";

import { useState } from 'react';
import type { Provider } from '../lib/results';

const colors = ['#007d64','#5163a8','#ad5229','#925c95','#247a9c','#926b18','#ac4e67','#507d35','#674bc1','#4d7373','#aa4944','#4e5c70'];
export function methodColor(index: number) {
  return index < colors.length ? colors[index] : `hsl(${(index*137.508)%360} 58% 36%)`;
}
export default function MethodSelector({providers,hidden,onChange,t,coverage,colors: colorMap}: {
  providers: Pick<Provider,'id'|'name'>[];hidden:string[];onChange:(ids:string[])=>void;t:(text:string)=>string;
  coverage?: Record<string,string>;colors?:Record<string,string>;
}) {
  const [query,setQuery]=useState('');
  const displayName=(provider: Pick<Provider,'name'>)=>provider.name.split(' · ').map(t).join(' · ');
  const matches=providers.filter(provider=>[provider.name,displayName(provider)].some(name=>name.toLowerCase().includes(query.toLowerCase())));
  return <div className="method-selector">
    <label className="method-search">{t('Find a method')}<input value={query} onChange={event=>setQuery(event.currentTarget.value)} type="search"/></label>
    <div className="method-selection-actions"><button onClick={()=>onChange(hidden.filter(id=>!providers.some(provider=>provider.id===id)))}>{t('Select all')}</button><button onClick={()=>onChange([...new Set([...hidden,...providers.map(provider=>provider.id)])])}>{t('Clear')}</button></div>
    <div className="radar-legend" role="group" aria-label={t('Methods to compare')}>
      {matches.map(provider=><label key={provider.id} style={{color:colorMap?.[provider.id]??methodColor(providers.findIndex(item=>item.id===provider.id))}}>
        <input type="checkbox" checked={!hidden.includes(provider.id)} onChange={event=>onChange(event.currentTarget.checked?hidden.filter(id=>id!==provider.id):[...hidden,provider.id])}/>
        <span>{displayName(provider)}{coverage?.[provider.id]&&<small> · {coverage[provider.id]}</small>}</span>
      </label>)}
      {matches.length===0&&<p role="status">{t('No matching methods')}</p>}
    </div>
  </div>;
}
