export type TextColor = "blue" | "red";
export interface TextSpan {
  text: string;
  bold?: boolean;
  color?: TextColor;
}
export type RichText = TextSpan[];
export type Alignment = "left" | "center" | "right";
export interface CellAddress {
  row: number;
  column: number;
}
export interface SumFormula {
  type: "SUM";
  from: CellAddress;
  to: CellAddress;
}
export interface TableCell extends CellAddress {
  rowSpan: number;
  colSpan: number;
  alignment: Alignment;
  paragraphs: RichText[];
  formula?: SumFormula;
}
export interface WorkTable {
  id: string;
  rows: number;
  columns: number;
  /** HWPUNIT (1/7200 inch), retained from the form. */
  columnWidths: number[];
  rowHeights: number[];
  caption: RichText[];
  cells: TableCell[];
}
export interface WorkItem {
  /** Stable identity also lets the exporter reuse the source item's typography. */
  id: string;
  title: RichText;
  /** Lines retain their visible bullet/label and spacing. Blank lines are significant. */
  content: RichText[];
  notes: RichText[];
  tables: WorkTable[];
  assignee: string;
}
export const categories = ["lastWeek", "thisWeek", "ongoing"] as const;
export type WorkCategory = (typeof categories)[number];
export interface Department {
  id: string;
  name: string;
  parentOffice?: string;
  labels: { lastWeek: string; thisWeek: string; ongoing: string };
  items: Record<WorkCategory, WorkItem[]>;
}
export interface WeeklyPlan {
  title: string;
  titlePeriod: string;
  writtenDate: string;
  lastWeekPeriod: string;
  thisWeekPeriod: string;
  departments: Department[];
}
export const plainText = (text: RichText): string =>
  text.map((span) => span.text).join("");

/** Formula addresses are zero-based; only numeric cells in the rectangle contribute. */
export function sumValue(table: WorkTable, formula: SumFormula): number {
  return table.cells.reduce((sum, cell) => {
    if (
      cell.row < formula.from.row || cell.row > formula.to.row ||
      cell.column < formula.from.column || cell.column > formula.to.column
    ) return sum;
    const value = cell.paragraphs.map(plainText).join("").replaceAll(",", "").trim();
    return sum + (/^[+-]?\d+(\.\d+)?$/.test(value) ? Number(value) : 0);
  }, 0);
}
