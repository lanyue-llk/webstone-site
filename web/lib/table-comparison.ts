import { bestValue, compareValues, isBestValue } from './results.ts';

export type SortDirection = 'asc' | 'desc';
export type NumericColumn<Row> = {
  id: string;
  value: (row: Row) => number | null | undefined;
  direction: SortDirection;
  highlight?: boolean;
  rankable?: boolean;
};

// Ranks describe the selected metric in its declared direction. Reversing the
// display order changes neither ranks nor column winners; ties share a rank.
export function tableComparison<Row extends {id: string}>(rows: Row[], columns: NumericColumn<Row>[], sortId: string, direction: SortDirection, tie?: (a: Row, b: Row) => number) {
  const selected = columns.find(column => column.id === sortId) ?? columns[0];
  const ordered = [...rows].sort((a, b) => compareValues(selected.value(a), selected.value(b), direction) || tie?.(a, b) || 0);
  const ranked = [...rows].sort((a, b) => compareValues(selected.value(a), selected.value(b), selected.direction));
  const ranks = new Map<string, number>();
  let rank = 0;
  ranked.forEach((row, index) => {
    const value = selected.value(row);
    if (value === null || value === undefined || selected.rankable === false) return;
    if (index === 0 || value !== selected.value(ranked[index - 1])) rank = index + 1;
    ranks.set(row.id, rank);
  });
  const winners = new Map(columns.map(column => [column.id, column.highlight === false ? null : bestValue(rows.map(column.value), column.direction)]));
  return { ordered, ranks, selected, winner: (row: Row, column: NumericColumn<Row>) => isBestValue(column.value(row), winners.get(column.id) ?? null) };
}
