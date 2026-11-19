import type { Database } from "bun:sqlite";
import type {
  DashboardView, ItemAction, ItemReview, ItemStatus, Person, ReviewStage, SectionReview, TodoView,
} from "../shared/api";
import type { WorkCategory, WorkItem } from "../shared/weekly-plan";
import { currentWeekId, organisations } from "./database";
import { ApiFailure, text } from "./validation";

interface ReviewItem {
  id: string;
  sectionId: number;
  departmentId: string;
  category: WorkCategory;
  status: ItemStatus;
  content_json: string;
}
interface Section {
  id: number;
  departmentId: string;
  name: string;
  parentId: string | null;
}
interface SectionRow {
  stageId: number;
  status: ItemStatus;
  submittedAt: number;
  decidedAt: number | null;
  actorId: number;
  versions_json: string;
}

export function createReview(db: Database, now: () => number, weekId?: number) {
  const stages = (): ReviewStage[] => db.query<ReviewStage, []>(`SELECT id, organisation_id AS organisationId,
    reviewer_id AS reviewerId, parent_stage_id AS parentStageId, review_unit AS reviewUnit
    FROM review_stages ORDER BY position`).all();
  function sections(): Section[] {
    return db.query<Section, [number]>(`SELECT s.id, s.department_id AS departmentId, o.name, o.parent_id AS parentId
      FROM sections s JOIN weeks w ON w.id = s.week_id JOIN organisations o ON o.id = s.department_id
      WHERE w.id = ? ORDER BY s.position`).all(weekId ?? currentWeekId(db));
  }
  function items(sectionId: number): ReviewItem[] {
    return db.query<ReviewItem, [number]>(`SELECT i.id, i.section_id AS sectionId, s.department_id AS departmentId,
      i.category, i.status, i.content_json FROM items i JOIN sections s ON s.id = i.section_id
      WHERE i.section_id = ? ORDER BY i.category, i.position`).all(sectionId);
  }
  function item(id: string): ReviewItem {
    const row = db.query<ReviewItem, [string]>(`SELECT i.id, i.section_id AS sectionId,
      s.department_id AS departmentId, i.category, i.status, i.content_json FROM items i
      JOIN sections s ON s.id = i.section_id WHERE i.id = ?`).get(id);
    if (!row) throw new ApiFailure(404, "업무 항목을 찾을 수 없습니다.");
    return row;
  }
  function path(departmentId: string): ReviewStage[] {
    const all = stages(), result: ReviewStage[] = [];
    let stage = all.find((stage) => stage.organisationId === departmentId);
    while (stage) {
      result.push(stage);
      stage = all.find((candidate) => candidate.id === stage!.parentStageId);
    }
    return result;
  }
  function owns(stage: ReviewStage, person: Person): boolean {
    return person.role !== "writer" && stage.reviewerId === person.id;
  }
  function assigned(id: string, person: Person): boolean {
    return !!db.query("SELECT 1 FROM assignments WHERE item_id = ? AND person_id = ?").get(id, person.id);
  }
  function inScope(departmentId: string, person: Person): boolean {
    if (path(departmentId).some((stage) => owns(stage, person))) return true;
    const units = organisations(db);
    let id: string | null = departmentId;
    while (id) {
      if (id === person.organisationId) return true;
      id = units.find((unit) => unit.id === id)?.parentId ?? null;
    }
    return false;
  }
  function latest(id: string) {
    return db.query<{
      id: number; number: number; content_json: string; requestedAt: number; requestedBy: number; changed: number;
    }, [string]>(`SELECT id, number, content_json, requested_at AS requestedAt,
      requested_by AS requestedBy, changed FROM item_versions WHERE item_id = ? ORDER BY number DESC LIMIT 1`).get(id);
  }
  function itemReview(id: string): ItemReview {
    const version = latest(id);
    return {
      version: version ? {
        id: version.id, number: version.number, requestedAt: version.requestedAt,
        requestedBy: version.requestedBy, changed: !!version.changed, content: JSON.parse(version.content_json),
      } : null,
      messages: db.query<ItemReview["messages"][number], [string]>(`SELECT r.id, r.version_id AS versionId,
        r.stage_id AS stageId, r.actor_id AS actorId, r.at, r.message FROM review_records r
        JOIN item_versions v ON v.id = r.version_id WHERE v.item_id = ? AND r.action = 'returned'
        ORDER BY r.id`).all(id),
    };
  }
  function changed(row: ReviewItem): boolean {
    const previous = latest(row.id);
    return !!previous && (!!previous.changed || previous.content_json !== row.content_json);
  }
  function actions(id: string, person: Person): ItemAction[] {
    const row = item(id), result: ItemAction[] = [];
    const busy = db.query<{ personId: number }, [string, number]>(`SELECT person_id AS personId FROM edit_locks
      WHERE item_id = ? AND expires_at > ?`).get(id, now());
    if (assigned(id, person) && (!busy || busy.personId === person.id)) {
      if (row.status === "검토 요청") result.push("withdraw");
      if (row.status === "작성 중" || row.status === "수정 요청") result.push("request-review");
    }
    const stage = path(row.departmentId)[0];
    if (stage && stage.reviewUnit === "item" && owns(stage, person)) {
      if (row.status === "검토 요청") result.push("approve");
      if (row.status === "검토 요청" || row.status === "승인") result.push("return");
    }
    return result;
  }
  function invalidate(sectionId: number): void {
    db.query("UPDATE review_sections SET status = '작성 중', decided_at = NULL WHERE section_id = ?").run(sectionId);
  }
  function contentChanged(id: string): void {
    const row = item(id);
    if (row.status === "검토 요청") throw new ApiFailure(409, "검토 요청을 회수한 뒤 수정하세요.");
    if (row.status === "승인" || row.status === "수정 요청")
      db.query("UPDATE items SET status = '작성 중' WHERE id = ?").run(id);
    invalidate(row.sectionId);
  }
  function record(stageId: number, sectionId: number, versionId: number | null, action: string,
    person: Person, versionIds: number[], message: string | null = null): void {
    db.query(`INSERT INTO review_records
      (stage_id, section_id, version_id, action, actor_id, at, message, versions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      stageId, sectionId, versionId, action, person.id, now(), message, JSON.stringify(versionIds),
    );
  }
  function itemAction(id: string, action: ItemAction, person: Person, input: Record<string, unknown>): void {
    const row = item(id), stage = path(row.departmentId)[0];
    if (!stage) throw new ApiFailure(409, "등록된 검토 단계가 없습니다.");
    const writerAction = action === "request-review" || action === "withdraw";
    if (writerAction ? !assigned(id, person) : !owns(stage, person) || stage.reviewUnit !== "item")
      throw new ApiFailure(403, "이 항목에서 해당 동작을 할 권한이 없습니다.");
    if (!actions(id, person).includes(action)) throw new ApiFailure(409, "현재 상태에서는 해당 동작을 할 수 없습니다.");
    db.transaction(() => {
      let version = latest(id);
      if (action === "request-review") {
        const content: WorkItem = JSON.parse(row.content_json);
        if (![...content.title, ...content.content.flat(), ...content.notes.flat()].some((span) => span.text.trim()) &&
          !content.tables.length) throw new ApiFailure(409, "내용을 저장한 뒤 검토를 요청하세요.");
        const inserted = db.query(`INSERT INTO item_versions
          (item_id, number, content_json, requested_at, requested_by, changed) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(id, (version?.number ?? 0) + 1, row.content_json, now(), person.id,
            version && (version.changed || version.content_json !== row.content_json) ? 1 : 0);
        version = latest(id)!;
        record(stage.id, row.sectionId, Number(inserted.lastInsertRowid), "requested", person, [version.id]);
        db.query("UPDATE items SET status = '검토 요청' WHERE id = ?").run(id);
      } else {
        if (!version) throw new ApiFailure(409, "검토 요청 버전이 없습니다.");
        const message = action === "return" ? text(input.message, "수정 요청 메시지") : null;
        if (action !== "approve") invalidate(row.sectionId);
        db.query("UPDATE items SET status = ? WHERE id = ?").run(
          action === "withdraw" ? "작성 중" : action === "approve" ? "승인" : "수정 요청", id,
        );
        record(stage.id, row.sectionId, version.id,
          action === "withdraw" ? "withdrawn" : action === "approve" ? "approved" : "returned",
          person, [version.id], message);
      }
      db.query("DELETE FROM edit_locks WHERE item_id = ?").run(id);
    })();
  }
  function sectionRow(sectionId: number, stageId: number): SectionRow | null {
    return db.query<SectionRow, [number, number]>(`SELECT stage_id AS stageId, status,
      submitted_at AS submittedAt, decided_at AS decidedAt, actor_id AS actorId, versions_json
      FROM review_sections WHERE section_id = ? AND stage_id = ?`).get(sectionId, stageId);
  }
  function stageSections(stageId: number): Section[] {
    return sections().filter((section) => path(section.departmentId).some((stage) => stage.id === stageId));
  }
  function sectionActions(stage: ReviewStage, sectionId: number, person: Person): ("approve" | "return")[] {
    if (!owns(stage, person) || stage.reviewUnit !== "section") return [];
    const row = sectionRow(sectionId, stage.id);
    return row?.status === "검토 요청" ? ["approve", "return"] : row?.status === "승인" ? ["return"] : [];
  }
  function canSubmit(stage: ReviewStage): boolean {
    if (stage.parentStageId === null) return false;
    const scoped = stageSections(stage.id);
    return scoped.length > 0 && scoped.every((section) => stage.reviewUnit === "item" ?
      items(section.id).length > 0 && items(section.id).every((row) => row.status === "승인") :
      sectionRow(section.id, stage.id)?.status === "승인") &&
      scoped.some((section) => !["검토 요청", "승인"].includes(sectionRow(section.id, stage.parentStageId!)?.status ?? ""));
  }
  function ownedStage(id: number, person: Person): ReviewStage {
    const stage = stages().find((stage) => stage.id === id);
    if (!stage) throw new ApiFailure(404, "검토 단계를 찾을 수 없습니다.");
    if (!owns(stage, person)) throw new ApiFailure(403, "해당 검토 단계의 검토자만 처리할 수 있습니다.");
    return stage;
  }
  function submit(stageId: number, person: Person): void {
    const stage = ownedStage(stageId, person);
    if (!canSubmit(stage)) throw new ApiFailure(409, "소속 대상이 모두 승인되어야 상신할 수 있습니다.");
    db.transaction(() => {
      for (const section of stageSections(stage.id)) {
        const current = sectionRow(section.id, stage.parentStageId!);
        if (current && ["검토 요청", "승인"].includes(current.status)) continue;
        const versionIds = items(section.id).map((row) => latest(row.id)!.id);
        db.query(`INSERT INTO review_sections
          (section_id, stage_id, status, versions_json, submitted_at, decided_at, actor_id)
          VALUES (?, ?, '검토 요청', ?, ?, NULL, ?) ON CONFLICT(section_id, stage_id) DO UPDATE SET
          status = excluded.status, versions_json = excluded.versions_json, submitted_at = excluded.submitted_at,
          decided_at = NULL, actor_id = excluded.actor_id`).run(
          section.id, stage.parentStageId!, JSON.stringify(versionIds), now(), person.id,
        );
        record(stage.id, section.id, null, "submitted", person, versionIds);
      }
    })();
  }
  function decideSection(stageId: number, departmentId: string, action: "approve" | "return",
    person: Person, input: Record<string, unknown>): void {
    const stage = ownedStage(stageId, person);
    const section = stageSections(stage.id).find((section) => section.departmentId === departmentId);
    if (!section || stage.reviewUnit !== "section") throw new ApiFailure(403, "소속 범위의 처 섹션만 검토할 수 있습니다.");
    if (!sectionActions(stage, section.id, person).includes(action))
      throw new ApiFailure(409, "현재 상태에서는 해당 동작을 할 수 없습니다.");
    const current = sectionRow(section.id, stage.id)!;
    const versionIds: number[] = JSON.parse(current.versions_json);
    db.transaction(() => {
      if (action === "return") {
        const message = text(input.message, "수정 요청 메시지");
        if (!Array.isArray(input.itemIds) || !input.itemIds.length ||
          input.itemIds.some((id) => typeof id !== "string") || new Set(input.itemIds).size !== input.itemIds.length)
          throw new ApiFailure(400, "수정할 항목을 하나 이상 지목하세요.");
        const targets = input.itemIds.map((id) => item(id));
        if (targets.some((row) => row.sectionId !== section.id))
          throw new ApiFailure(403, "해당 처 섹션의 항목만 지목할 수 있습니다.");
        invalidate(section.id);
        for (const row of targets) {
          const version = latest(row.id)!;
          db.query("UPDATE items SET status = '수정 요청' WHERE id = ?").run(row.id);
          db.query("DELETE FROM edit_locks WHERE item_id = ?").run(row.id);
          record(stage.id, section.id, version.id, "returned", person, versionIds, message);
        }
      } else record(stage.id, section.id, null, "approved", person, versionIds);
      db.query(`UPDATE review_sections SET status = ?, decided_at = ?, actor_id = ?
        WHERE section_id = ? AND stage_id = ?`).run(
        action === "approve" ? "승인" : "수정 요청", now(), person.id, section.id, stage.id,
      );
    })();
  }
  function aggregate(statuses: ItemStatus[]): ItemStatus {
    if (!statuses.length || statuses.every((status) => status === "미작성")) return "미작성";
    if (statuses.includes("수정 요청")) return "수정 요청";
    if (statuses.every((status) => status === "승인")) return "승인";
    if (statuses.some((status) => status === "미작성" || status === "작성 중")) return "작성 중";
    return "검토 요청";
  }
  function dashboard(person: Person): DashboardView {
    const allStages = stages();
    const departments = sections().map((section) => {
      const rows = items(section.id), scoped = inScope(section.departmentId, person);
      const reviews: SectionReview[] = path(section.departmentId).flatMap((stage) => {
        const row = sectionRow(section.id, stage.id);
        return row ? [{
          stageId: stage.id, status: row.status, submittedAt: row.submittedAt, decidedAt: row.decidedAt,
          actorId: row.actorId, versionIds: scoped ? JSON.parse(row.versions_json) : [],
          actions: sectionActions(stage, section.id, person),
        }] : [];
      });
      const counts = { "미작성": 0, "작성 중": 0, "검토 요청": 0, "수정 요청": 0, "승인": 0 };
      for (const row of rows) counts[row.status]++;
      return {
        departmentId: section.departmentId, name: section.name, parentId: section.parentId,
        status: aggregate([...rows.map((row) => row.status), ...reviews.map((row) => row.status)]),
        counts, items: scoped ? rows.map((row) => ({
          id: row.id, category: row.category, status: row.status, changed: changed(row), actions: actions(row.id, person),
        })) : [], reviews,
      };
    });
    return {
      weekId: weekId ?? currentWeekId(db),
      revision: db.query<{ revision: number }, []>("SELECT revision FROM change_revision WHERE id = 1").get()!.revision,
      pollIntervalMs: 1000,
      stages: allStages.map((stage) => ({ ...stage, actions: owns(stage, person) && canSubmit(stage) ? ["submit"] : [] })),
      departments,
      offices: organisations(db).filter((unit) => unit.kind === "office").map((office) => {
        const children = departments.filter((department) => department.parentId === office.id);
        return {
          organisationId: office.id, name: office.name, status: aggregate(children.map((child) => child.status)),
          departmentIds: children.map((child) => child.departmentId),
        };
      }),
    };
  }
  function todos(person: Person): TodoView {
    const view = dashboard(person), result: TodoView["todos"] = [];
    for (const section of sections()) {
      for (const row of items(section.id)) {
        if (assigned(row.id, person) && ["미작성", "작성 중", "수정 요청"].includes(row.status))
          result.push({ kind: "write", itemId: row.id, departmentId: row.departmentId,
            status: row.status, actions: actions(row.id, person).filter((action) => action === "request-review") });
        if (actions(row.id, person).includes("approve"))
          result.push({ kind: "review-item", itemId: row.id, departmentId: row.departmentId,
            status: row.status, actions: actions(row.id, person).filter((action) => action === "approve" || action === "return") });
      }
      for (const stage of stages()) {
        const allowed = sectionActions(stage, section.id, person);
        if (allowed.includes("approve"))
          result.push({ kind: "review-section", departmentId: section.departmentId, stageId: stage.id, actions: allowed });
      }
    }
    for (const stage of view.stages) if (stage.actions.length)
      result.push({ kind: "submit", stageId: stage.id, actions: stage.actions });
    return { weekId: view.weekId, revision: view.revision, pollIntervalMs: view.pollIntervalMs, todos: result };
  }
  return { inScope, itemReview, actions, contentChanged, invalidate, itemAction, submit, decideSection, dashboard, todos };
}
