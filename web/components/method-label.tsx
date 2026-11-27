import type { ReactNode } from 'react';

export default function MethodLabel({name,t,children}:{name:string;t:(text:string)=>string;children?:ReactNode}) {
  const separator=name.includes(' · ')?' · ':' + ';
  const [product,...configuration]=name.split(separator);
  return <span className="provider-label" title={name}>
    <strong>{product}</strong>
    {configuration.length>0&&<small>{t(configuration.join(separator))}</small>}
    {children}
  </span>;
}
