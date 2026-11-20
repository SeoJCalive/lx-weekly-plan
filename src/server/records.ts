import type { Database } from "bun:sqlite";
import type {
  DeadlineView, HistoryField, ItemChange, ItemHistory, ItemHistoryEntry, Person, SectionHistory, SectionHistoryEntry, StatisticsView, WeekSummary,
} from "../shared/api";
import type { WorkItem } from "../shared/weekly-plan";
import { people } from "./database";
import { ApiFailure } from "./validation";

export function itemHistory(db: Database, itemId: string): ItemHistory {
  const actors = people(db);
  const rows = db.query<{
    id: number; action: ItemHistoryEntry["action"]; at: number; actorId: number; stageId: number; reviewUnit: ItemHistoryEntry["reviewUnit"];
    versionId: number; versionNumber: number; content_json: string; message: string | null; note: string | null;
  }, [string]>(`SELECT r.id, r.action, r.at, r.actor_id AS actorId, r.stage_id AS stageId,
    v.id AS versionId, v.number AS versionNumber, v.content_json, v.note, r.message, stage.review_unit AS reviewUnit
    FROM review_records r JOIN review_stages stage ON stage.id = r.stage_id JOIN item_versions v ON v.item_id = ? AND
      (r.version_id = v.id OR (r.version_id IS NULL AND
        EXISTS (SELECT 1 FROM json_each(r.versions_json) WHERE value = v.id)))
    WHERE r.action IN ('requested','returned','approved') ORDER BY r.at, r.id`).all(itemId);
  let previous: WorkItem | undefined;
  const entries = rows.map(({ actorId, content_json, ...row }): ItemHistoryEntry => {
    const content: WorkItem = JSON.parse(content_json);
    const fields: HistoryField[] = ["title", "content", "notes", "tables", "assignee"];
    const changes = previous ? fields.filter((field) => !Bun.deepEquals(previous![field], content[field]))
      .map((field) => ({ field, oldValue: previous![field], newValue: content[field] }) as ItemChange) : [];
    previous = content;
    return { ...row, actor: actors.find((person) => person.id === actorId)!, content, changes };
  });
  return { itemId, entries };
}

export function sectionHistory(db: Database, departmentId: string, weekId: number): SectionHistory {
  const actors = people(db);
  const rows = db.query<{
    id: number; action: SectionHistoryEntry["action"]; at: number; actorId: number; stageId: number;
    reviewUnit: SectionHistoryEntry["reviewUnit"]; message: string | null; versions_json: string; versionId: number | null;
  }, [string, number]>(`SELECT r.id, r.action, r.at, r.actor_id AS actorId, r.stage_id AS stageId,
    stage.review_unit AS reviewUnit, r.message, r.versions_json, r.version_id AS versionId FROM review_records r
    JOIN sections s ON s.id = r.section_id JOIN review_stages stage ON stage.id = r.stage_id
    WHERE s.department_id = ? AND s.week_id = ? AND
      (r.action = 'submitted' OR (stage.review_unit = 'section' AND r.action IN ('approved','returned')))
    ORDER BY r.at, r.id`).all(departmentId, weekId);
  const entries: SectionHistoryEntry[] = [];
  rows.forEach(({ actorId, versions_json, versionId, ...row }, index) => {
    const items = row.action !== "returned" ? [] : db.query<{ itemId: string; content_json: string }, [string]>(
      `SELECT item_id AS itemId, content_json FROM item_versions WHERE id IN (SELECT value FROM json_each(?))
       ORDER BY id`,
    ).all(versionId === null ? versions_json : JSON.stringify([versionId])).map(({ itemId, content_json }) => {
      const content: WorkItem = JSON.parse(content_json);
      return { itemId, title: content.title, entryId: row.id };
    });
    const prior = rows[index - 1], previous = entries.at(-1);
    // Earlier section returns wrote contiguous target rows within one transaction.
    // Another return requires a new submitted record, so those rows form one decision.
    if (row.action === "returned" && versionId !== null && prior?.versionId !== null && previous &&
      prior?.id === row.id - 1 && prior.action === "returned" && prior.stageId === row.stageId &&
      prior.actorId === actorId && prior.message === row.message && prior.versions_json === versions_json) {
      entries[entries.length - 1] = { ...previous, items: [...previous.items, ...items] };
    } else entries.push({ ...row, actor: actors.find(person => person.id === actorId)!, items });
  });
  return { departmentId, entries };
}

export function createRecords(db: Database, now: () => number, week: WeekSummary) {
  function canChange(person: Person): boolean {
    return person.role === "director" && !!db.query(`SELECT id FROM review_stages
      WHERE parent_stage_id IS NULL AND review_unit = 'section' AND reviewer_id = ?`).get(person.id);
  }
  function deadline(person: Person): DeadlineView {
    const override = db.query<{ deadline_at: number | null }, [number]>(
      "SELECT deadline_at FROM weeks WHERE id = ?",
    ).get(week.id)!.deadline_at;
    const [year, month, day] = week.writtenDate.match(/\d+/g)!.map(Number);
    // writtenDate is the week's Monday. Thursday ends at 14:59:59.999 UTC (KST +09:00).
    const deadlineAt = override ?? Date.UTC(year, month - 1, day + 3, 14, 59, 59, 999);
    return { weekId: week.id, deadlineAt, passed: now() > deadlineAt, canChange: canChange(person) };
  }
  function changeDeadline(value: unknown, person: Person): DeadlineView {
    if (!canChange(person)) throw new ApiFailure(403, "최종 결정자만 마감 일시를 바꿀 수 있습니다.");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()))
      throw new ApiFailure(400, "마감 일시는 유효한 밀리초 단위 시각이어야 합니다.");
    db.query("UPDATE weeks SET deadline_at = ? WHERE id = ?").run(value, week.id);
    return deadline(person);
  }
  function statistics(person: Person): StatisticsView {
    const due = deadline(person);
    const rows = db.query<{
      departmentId: string; name: string; revisions: number; revisionRequests: number; firstSubmittedAt: number | null;
    }, [number]>(`SELECT s.department_id AS departmentId, o.name,
      (SELECT COUNT(*) FROM item_versions v JOIN items i ON i.id = v.item_id
        WHERE i.section_id = s.id AND v.number > 1) AS revisions,
      (SELECT COALESCE(SUM(CASE WHEN r.version_id IS NULL THEN json_array_length(r.versions_json) ELSE 1 END), 0)
        FROM review_records r WHERE r.section_id = s.id AND r.action = 'returned') AS revisionRequests,
      (SELECT MIN(r.at) FROM review_records r JOIN review_stages stage ON stage.id = r.stage_id
        WHERE r.section_id = s.id AND r.action = 'submitted'
          AND stage.organisation_id = s.department_id) AS firstSubmittedAt
      FROM sections s JOIN organisations o ON o.id = s.department_id
      WHERE s.week_id = ? ORDER BY s.position`).all(week.id);
    return {
      weekId: week.id, deadline: due,
      departments: rows.map((row) => ({
        ...row, deadlineMet: row.firstSubmittedAt === null ? due.passed ? false : null :
          row.firstSubmittedAt <= due.deadlineAt,
      })),
    };
  }
  return { deadline, changeDeadline, statistics };
}
