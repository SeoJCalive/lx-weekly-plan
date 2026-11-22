import type { Database } from "bun:sqlite";
import type { BoardDocument, BoardPost, Person, PublishResult, WeekSummary } from "../shared/api";
import type { WeeklyPlan, WorkItem } from "../shared/weekly-plan";
import { currentWeekId, readPlan } from "./database";
import { generateHwpx } from "./hwpx";
import { createReview } from "./review";
import { ApiFailure } from "./validation";

const postColumns = `id, week_id AS weekId, version, title, published_at AS publishedAt, published_by AS publishedBy`;

export function createPublishing(db: Database, templateBytes: Uint8Array, now: () => number) {
  function weeks(): WeekSummary[] {
    return db.query<{
      id: number; metadata_json: string; is_current: number; nextWeekId: number | null;
    }, []>(`SELECT w.id, w.metadata_json, w.is_current, r.next_week_id AS nextWeekId FROM weeks w
      LEFT JOIN week_rollovers r ON r.source_week_id = w.id ORDER BY w.id DESC`).all()
      .map((row) => ({
        ...JSON.parse(row.metadata_json), id: row.id, isCurrent: !!row.is_current, nextWeekId: row.nextWeekId,
      }));
  }
  function week(id = currentWeekId(db)): WeekSummary {
    const found = weeks().find((week) => week.id === id);
    if (!found) throw new ApiFailure(404, "주차를 찾을 수 없습니다.");
    return found;
  }
  function finalStage(person: Person): number {
    const stage = db.query<{ id: number }, [number]>(`SELECT id FROM review_stages
      WHERE parent_stage_id IS NULL AND reviewer_id = ? AND review_unit = 'section'`).get(person.id);
    if (person.role !== "director" || !stage)
      throw new ApiFailure(403, "최종 승인자만 게시하거나 다음 주차를 열 수 있습니다.");
    return stage.id;
  }
  function posts(): BoardPost[] {
    return db.query<BoardPost, []>(`SELECT ${postColumns} FROM board_posts ORDER BY id DESC`).all();
  }
  function post(id: number): BoardDocument {
    const row = db.query<BoardPost & { document_json: string }, [number]>(
      `SELECT ${postColumns}, document_json FROM board_posts WHERE id = ?`,
    ).get(id);
    if (!row) throw new ApiFailure(404, "게시물을 찾을 수 없습니다.");
    const { document_json, ...summary } = row;
    return { ...summary, document: JSON.parse(document_json) };
  }
  function download(id: number): Uint8Array {
    const row = db.query<{ hwpx: Uint8Array }, [number]>("SELECT hwpx FROM board_posts WHERE id = ?").get(id);
    if (!row) throw new ApiFailure(404, "게시물을 찾을 수 없습니다.");
    return row.hwpx;
  }
  function openNext(weekId: number, person: Person): WeekSummary {
    finalStage(person);
    week(weekId);
    return db.transaction(() => {
      const existing = db.query<{ id: number }, [number]>(
        "SELECT next_week_id AS id FROM week_rollovers WHERE source_week_id = ?",
      ).get(weekId);
      if (existing) return week(existing.id);
      const source = readPlan(db, weekId);
      const [year, month, day] = source.writtenDate.match(/\d+/g)!.map(Number);
      const monday = new Date(Date.UTC(year, month - 1, day + 7));
      const friday = new Date(Date.UTC(year, month - 1, day + 11));
      const notation = (date: Date, gap: string) => `${date.getUTCMonth() + 1}.${gap}${date.getUTCDate()}.`;
      const metadata: Omit<WeeklyPlan, "departments"> = {
        title: source.title,
        titlePeriod: `<${notation(monday, "　")}　~　${notation(friday, "　")}>`,
        writtenDate: `${monday.getUTCFullYear()}. ${monday.getUTCMonth() + 1}. ${monday.getUTCDate()}.`,
        lastWeekPeriod: source.thisWeekPeriod,
        thisWeekPeriod: `(${notation(monday, " ")} ~ ${notation(friday, " ")})`,
      };
      db.query("UPDATE weeks SET is_current = 0 WHERE is_current = 1").run();
      const inserted = db.query("INSERT INTO weeks (metadata_json, is_current) VALUES (?, 1)")
        .run(JSON.stringify(metadata));
      const nextId = Number(inserted.lastInsertRowid);
      const sections = db.query<{
        id: number; department_id: string; labels_json: string; position: number;
      }, [number]>("SELECT id, department_id, labels_json, position FROM sections WHERE week_id = ? ORDER BY position")
        .all(weekId);
      for (const section of sections) {
        const nextSection = db.query(`INSERT INTO sections (week_id, department_id, labels_json, position)
          VALUES (?, ?, ?, ?)`).run(nextId, section.department_id, section.labels_json, section.position);
        const rows = db.query<{
          id: string; category: string; position: number; content_json: string; creator_id: number | null;
          assignee_mode: string;
        }, [number]>(`SELECT id, category, position, content_json, creator_id, assignee_mode FROM items
          WHERE section_id = ? AND category IN ('thisWeek','ongoing') ORDER BY category, position`).all(section.id);
        for (const row of rows) {
          const original: WorkItem = JSON.parse(row.content_json);
          const copy: WorkItem = {
            ...original, id: crypto.randomUUID(), templateItemId: original.templateItemId ?? original.id,
          };
          const hasContent = [...copy.title, ...copy.content.flat(), ...copy.notes.flat()]
            .some((span) => span.text.trim()) || copy.tables.length > 0;
          db.query(`INSERT INTO items
            (id, section_id, category, position, content_json, status, creator_id, assignee_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            copy.id, Number(nextSection.lastInsertRowid), row.category === "thisWeek" ? "lastWeek" : "ongoing",
            row.position, JSON.stringify(copy), hasContent ? "작성 중" : "미작성", row.creator_id, row.assignee_mode,
          );
          db.query(`INSERT INTO assignments (item_id, person_id)
            SELECT ?, person_id FROM assignments WHERE item_id = ? ORDER BY rowid`).run(copy.id, row.id);
        }
      }
      db.query("INSERT INTO week_rollovers VALUES (?, ?)").run(weekId, nextId);
      return week(nextId);
    })();
  }
  function publish(weekId: number, person: Person): PublishResult {
    const stageId = finalStage(person);
    week(weekId);
    return db.transaction(() => {
      const view = createReview(db, now, weekId).dashboard(person);
      if (!view.departments.length || view.departments.some((department) => department.status !== "승인" ||
        !department.reviews.some((review) => review.stageId === stageId && review.status === "승인")))
        throw new ApiFailure(409, "모든 처의 최종 승인 뒤에 게시할 수 있습니다.");
      const document = readPlan(db, weekId);
      const version = db.query<{ next: number }, [number]>(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM board_posts WHERE week_id = ?",
      ).get(weekId)!.next;
      const title = `${document.title} ${document.titlePeriod.replaceAll("　", "").replaceAll(" ", "")} ${version}차`;
      const inserted = db.query(`INSERT INTO board_posts
        (week_id, version, title, document_json, hwpx, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(weekId, version, title, JSON.stringify(document), generateHwpx(document, templateBytes), now(), person.id);
      const { document: _, ...summary } = post(Number(inserted.lastInsertRowid));
      return { post: summary, nextWeek: openNext(weekId, person) };
    })();
  }
  return { weeks, week, posts, post, download, openNext, publish };
}
