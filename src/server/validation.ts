import type { SaveItemRequest } from "../shared/api";
import type { RichText, WorkTable } from "../shared/weekly-plan";
import { validateTable } from "../shared/table-validation";

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
const objectParticle = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 ? "을" : "를";
};
export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiFailure(400, `${label}${objectParticle(label)} 입력하세요.`);
  return value.trim();
}
function richText(value: unknown): value is RichText {
  return Array.isArray(value) && value.every((span) => span && typeof span === "object" &&
    typeof span.text === "string" && (span.bold === undefined || typeof span.bold === "boolean") &&
    (span.color === undefined || span.color === "blue" || span.color === "red"));
}
const lines = (value: unknown): value is RichText[] => Array.isArray(value) && value.every(richText);
function table(value: unknown): value is WorkTable {
  const t = object(value);
  if (typeof t.id !== "string" || !t.id || !Array.isArray(t.columnWidths) || !Array.isArray(t.rowHeights) ||
    !lines(t.caption) || !Array.isArray(t.cells)) return false;
  for (const value of t.cells) {
    const c = object(value);
    if (!["left", "center", "right"].includes(String(c.alignment)) || !lines(c.paragraphs)) return false;
    if (c.styleFrom !== undefined) {
      const origin = object(c.styleFrom);
      if (![origin.row, origin.column].every(n => typeof n === "number" && Number.isInteger(n) && n >= 0)) return false;
    }
    if (c.formula !== undefined) {
      const f = object(c.formula);
      if (f.type !== "SUM" || !object(f.from) || !object(f.to)) return false;
    }
  }
  try { validateTable(value as WorkTable); } catch(e) { throw new ApiFailure(400,(e as Error).message); }
  return true;
}

export function saveInput(value: unknown): SaveItemRequest {
  const body = object(value);
  if (!richText(body.title) || !lines(body.content) || !lines(body.notes) ||
    !Array.isArray(body.tables) || !body.tables.every(table) ||
    (body.assignee !== undefined && body.assignee !== null && typeof body.assignee !== "string"))
    throw new ApiFailure(400, "제목, 내용, 참고 사항, 표 또는 담당자 형식이 올바르지 않습니다.");
  if(new Set(body.tables.map(t=>t.id)).size!==body.tables.length)throw new ApiFailure(400,"표 ID가 중복됩니다.");
  return {
    title: body.title, content: body.content, notes: body.notes, tables: body.tables,
    ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
  };
}
