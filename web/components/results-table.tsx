"use client";

import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { tableComparison, type NumericColumn, type SortDirection } from '../lib/table-comparison';

export type TableColumn<Row> = NumericColumn<Row> & {
  label: string;
  details?: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  winnerLabel: string;
  render: (row: Row) => ReactNode;
  title?: (row: Row) => string | undefined;
};

type Props<Row extends {id: string}> = {
  caption: string;
  rows: Row[];
  columns: TableColumn<Row>[];
  sortId: string;
  direction: SortDirection;
  onSort: (id: string, direction: SortDirection) => void;
  method: (row: Row) => ReactNode;
  toolbar: ReactNode;
  t: (text: string) => string;
  identity: string;
  overview?: boolean;
  empty?: string;
  tie?: (a: Row, b: Row) => number;
};

export default function ResultsTable<Row extends {id: string}>({caption, rows, columns, sortId, direction, onSort, method, toolbar, t, identity, overview = false, empty, tie}: Props<Row>) {
  const state = tableComparison(rows, columns, sortId, direction, tie);
  return <section id="results" className={`leaderboard table-panel${overview ? ' overview-leaderboard' : ''}`} style={{'--data-columns': columns.length} as CSSProperties} aria-label={caption}>
    {!overview && <h2 className="sr-only">{t('Leaderboard')}</h2>}
    <div className="table-toolbar">{toolbar}</div>
    <div key={identity} className={`table-scroll${overview ? ' overview-table-scroll' : ''}`} tabIndex={0} role="region" aria-label={t(overview ? 'Results comparison' : 'Leaderboard')}>
      <table className={`wide-table${overview ? ' track-results' : ''}`}>
        <caption className="sr-only">{caption}</caption>
        <colgroup><col className="rank-column"/><col className="provider-column"/>{columns.map(column => <col key={column.id}/>)}</colgroup>
        <thead><tr><th className="rank-cell" scope="col" aria-label={`${t('Rank by')} ${columns.find(column => column.id === state.selected.id)!.label}`}>#</th><th className="provider-heading method-cell" scope="col">{t('Method')}</th>
          {columns.map(column => {
            const active = column.id === state.selected.id;
            let ariaSort: 'ascending' | 'descending' | 'none' | undefined;
            if (column.sortable !== false) {
              ariaSort = 'none';
              if (active) ariaSort = direction === 'asc' ? 'ascending' : 'descending';
            }
            let nextDirection = column.direction;
            if (active) nextDirection = direction === 'desc' ? 'asc' : 'desc';
            return <th key={column.id} data-column={column.id} scope="col" className={`${active ? 'sorted ' : ''}${column.headerClassName ?? column.className ?? ''}`} aria-sort={ariaSort}>
              {column.before}<div className="metric-heading">{column.sortable === false ? <span>{column.label}</span> : <button className={`sort-button${active ? ' selected' : ''}`} onClick={() => onSort(column.id, nextDirection)}>{column.label}{active && <ArrowDown size={13} style={{transform: direction === 'asc' ? 'rotate(180deg)' : undefined}}/>}</button>}{column.details}</div>{column.after}
            </th>;
          })}
        </tr></thead>
        <tbody>{state.ordered.map(row => <tr key={row.id} data-provider={row.id}>
          <td className="rank-cell">{state.ranks.get(row.id) ?? '—'}</td>
          <td className="method-cell">{method(row)}</td>
          {columns.map(column => {
            const winner = state.winner(row, column);
            const title = [column.title?.(row), winner ? column.winnerLabel : undefined].filter(Boolean).join(' · ') || undefined;
            return <td key={column.id} data-column={column.id} className={`numeric ${column.className ?? ''}${column.id === state.selected.id ? ' primary-number' : ''}${winner ? ' best-value' : ''}`} title={title}>{column.render(row)}{winner && <span className="sr-only"> {column.winnerLabel}</span>}</td>;
          })}
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="comparison-empty" role="status">{empty ?? t('No published results')}</p>}
    </div>
  </section>;
}
