import type { SaveItemRequest } from "../shared/api";
import type { RichText, WorkTable } from "../shared/weekly-plan";

export class ApiFailure extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiFailure(400, "JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiFailure(400, `${label}을(를) 입력하세요.`);
  return value.trim();
}
function richText(value: unknown): value is RichText {
  return Array.isArray(value) && value.every((span) => span && typeof span === "object" &&
    typeof span.text === "string" && (span.bold === undefined || typeof span.bold === "boolean") &&
    (span.color === undefined || span.color === "blue" || span.color === "red"));
}
const lines = (value: unknown): value is RichText[] => Array.isArray(value) && value.every(richText);
const integer = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum;

function table(value: unknown): value is WorkTable {
  const t = object(value);
  if (typeof t.id !== "string" || !t.id || !integer(t.rows, 1) || !integer(t.columns, 1) ||
    !Array.isArray(t.columnWidths) || t.columnWidths.length !== t.columns ||
    !t.columnWidths.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) ||
    !Array.isArray(t.rowHeights) || t.rowHeights.length !== t.rows ||
    !t.rowHeights.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) ||
    !lines(t.caption) || !Array.isArray(t.cells)) return false;
  const occupied = new Set<string>();
  for (const value of t.cells) {
    const c = object(value);
    if (!integer(c.row, 0) || !integer(c.column, 0) || !integer(c.rowSpan, 1) || !integer(c.colSpan, 1) ||
      c.row + c.rowSpan > t.rows || c.column + c.colSpan > t.columns ||
      !["left", "center", "right"].includes(String(c.alignment)) || !lines(c.paragraphs)) return false;
    for (let row = c.row; row < c.row + c.rowSpan; row++) for (let column = c.column; column < c.column + c.colSpan; column++) {
      const key = `${row}/${column}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
    if (c.formula !== undefined) {
      const f = object(c.formula), from = object(f.from), to = object(f.to);
      if (f.type !== "SUM" || !integer(from.row, 0) || !integer(from.column, 0) ||
        !integer(to.row, 0) || !integer(to.column, 0) || from.row > to.row || from.column > to.column ||
        to.row >= t.rows || to.column >= t.columns ||
        (c.row >= from.row && c.row <= to.row && c.column >= from.column && c.column <= to.column)) return false;
    }
  }
  return occupied.size === t.rows * t.columns;
}

export function saveInput(value: unknown): SaveItemRequest {
  const body = object(value);
  if (!richText(body.title) || !lines(body.content) || !lines(body.notes) ||
    !Array.isArray(body.tables) || !body.tables.every(table) ||
    (body.assignee !== undefined && body.assignee !== null && typeof body.assignee !== "string"))
    throw new ApiFailure(400, "제목, 내용, 부가 설명, 표 또는 담당자 형식이 올바르지 않습니다.");
  return {
    title: body.title, content: body.content, notes: body.notes, tables: body.tables,
    ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
  };
}
