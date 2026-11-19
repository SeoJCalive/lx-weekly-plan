import type { Database } from "bun:sqlite";
import type { EditLock, ItemStatus, ItemView, Person, WeekView } from "../shared/api";
import { categories, type WorkCategory, type WorkItem } from "../shared/weekly-plan";
import { organisations, people, personColumns, readPlan } from "./database";
import { generateHwpx } from "./hwpx";
import { ApiFailure, object, saveInput, text } from "./validation";

export const lockIdleMs = 90_000;
interface ItemRow {
  id: string;
  departmentId: string;
  category: WorkCategory;
  content_json: string;
  status: ItemStatus;
  creatorId: number | null;
  assigneeMode: "automatic" | "manual";
}

export function createApp({ db, templateBytes, now = Date.now }: {
  db: Database;
  templateBytes: Uint8Array;
  now?: () => number;
}) {
  function currentPerson(request: Request): Person | null {
    const token = /(?:^|;\s*)lx_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
    if (!token) return null;
    return db.query<Person, [string]>(`SELECT ${personColumns} FROM sessions s
      JOIN people p ON p.id = s.person_id JOIN organisations o ON o.id = p.organisation_id
      WHERE s.token = ?`).get(token);
  }
  function itemRow(id: string): ItemRow {
    const row = db.query<ItemRow, [string]>(`SELECT i.id, s.department_id AS departmentId, i.category,
      i.content_json, i.status, i.creator_id AS creatorId, i.assignee_mode AS assigneeMode
      FROM items i JOIN sections s ON s.id = i.section_id JOIN weeks w ON w.id = s.week_id
      WHERE i.id = ? AND w.is_current = 1`).get(id);
    if (!row) throw new ApiFailure(404, "업무 항목을 찾을 수 없습니다.");
    return row;
  }
  function assignedPeople(id: string): Person[] {
    return db.query<Person, [string]>(`SELECT ${personColumns} FROM assignments a
      JOIN people p ON p.id = a.person_id JOIN organisations o ON o.id = p.organisation_id
      WHERE a.item_id = ? ORDER BY a.rowid`).all(id);
  }
  function lock(id: string): EditLock | null {
    const row = db.query<{ personId: number; name: string; expiresAt: number }, [string, number]>(
      `SELECT l.person_id AS personId, p.name, l.expires_at AS expiresAt
      FROM edit_locks l JOIN people p ON p.id = l.person_id WHERE l.item_id = ? AND l.expires_at > ?`,
    ).get(id, now());
    return row ? { ...row, message: `${row.name} 편집 중` } : null;
  }
  function editable(row: ItemRow, person: Person): void {
    if (!assignedPeople(row.id).some((assigned) => assigned.id === person.id))
      throw new ApiFailure(403, "할당된 담당자만 편집할 수 있습니다.");
  }
  function unlocked(id: string, person: Person): EditLock | null {
    const current = lock(id);
    if (current && current.personId !== person.id) throw new ApiFailure(423, current.message, { lock: current });
    return current;
  }
  function itemView(row: ItemRow, person: Person): ItemView {
    const assigned = assignedPeople(row.id), currentLock = lock(row.id);
    return {
      ...JSON.parse(row.content_json), departmentId: row.departmentId, category: row.category,
      status: row.status, creatorId: row.creatorId, assignedPeople: assigned, assigneeMode: row.assigneeMode,
      lock: currentLock, canEdit: assigned.some((assigned) => assigned.id === person.id) &&
        (!currentLock || currentLock.personId === person.id),
    };
  }
  function automaticAssignee(id: string): string {
    return assignedPeople(id).map((person) => `${person.name} ${person.title}`).join(", ");
  }
  function canAssign(departmentId: string, person: Person): boolean {
    const units = organisations(db);
    let id: string | null = departmentId;
    while (id) {
      if (id === person.organisationId) return true;
      id = units.find((unit) => unit.id === id)?.parentId ?? null;
    }
    return false;
  }
  async function body(request: Request): Promise<Record<string, unknown>> {
    try {
      return object(await request.json());
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure(400, "유효한 JSON을 보내세요.");
    }
  }
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const cookie = (token: string, clear = false) =>
    `lx_session=${token}; Path=/; HttpOnly; SameSite=Lax${clear ? "; Max-Age=0" : ""}`;

  return async function fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname, method = request.method;
      if (path === "/api/accounts" && method === "GET") return json(people(db));
      if (path === "/api/organisations" && method === "GET") return json(organisations(db));
      if (path === "/api/session" && method === "POST") {
        const input = await body(request);
        const name = text(input.name, "이름"), employeeNumber = text(input.employeeNumber, "사번");
        let person = people(db).find((person) => person.employeeNumber === employeeNumber);
        if (person && person.name !== name) throw new ApiFailure(400, "이름과 사번이 일치하지 않습니다.");
        if (!person) {
          if (!input.departmentId || !input.title)
            throw new ApiFailure(400, "처음 접속할 때 소속 처와 직급을 입력하세요.", { code: "PROFILE_REQUIRED" });
          const departmentId = text(input.departmentId, "소속 처"), title = text(input.title, "직급");
          if (!organisations(db).some((unit) => unit.id === departmentId && unit.kind === "department"))
            throw new ApiFailure(400, "등록된 처를 선택하세요.");
          const inserted = db.query(`INSERT INTO people (employee_number, name, title, organisation_id, role)
            VALUES (?, ?, ?, ?, 'writer')`).run(employeeNumber, name, title, departmentId);
          person = people(db).find((person) => person.id === Number(inserted.lastInsertRowid))!;
        }
        const token = crypto.randomUUID();
        // One-click account changes also release the previous account's locks in this browser.
        const previous = currentPerson(request);
        const previousToken = /(?:^|;\s*)lx_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
        db.transaction(() => {
          if (previous) db.query("DELETE FROM edit_locks WHERE person_id = ?").run(previous.id);
          if (previousToken) db.query("DELETE FROM sessions WHERE token = ?").run(previousToken);
          db.query("INSERT INTO sessions VALUES (?, ?)").run(token, person.id);
        })();
        return Response.json({ person }, { headers: { "Set-Cookie": cookie(token) } });
      }
      const person = currentPerson(request);
      if (path === "/api/session" && method === "GET") return json({ person });
      if (!person) throw new ApiFailure(401, "먼저 접속하세요.");
      if (path === "/api/session" && method === "DELETE") {
        const token = /(?:^|;\s*)lx_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")![1];
        db.transaction(() => {
          db.query("DELETE FROM edit_locks WHERE person_id = ?").run(person.id);
          db.query("DELETE FROM sessions WHERE token = ?").run(token);
        })();
        return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", true) } });
      }
      if (path === "/api/week" && method === "GET") {
        const plan = readPlan(db);
        const week = db.query<{ id: number }, []>("SELECT id FROM weeks WHERE is_current = 1").get()!;
        const result: WeekView = {
          ...plan, id: week.id,
          departments: plan.departments.map((department) => ({
            ...department,
            items: Object.fromEntries(categories.map((category) => [
              category, department.items[category].map((item) => itemView(itemRow(item.id), person)),
            ])) as WeekView["departments"][number]["items"],
          })),
        };
        return json(result);
      }
      if (path === "/api/week/hwpx" && method === "GET") return new Response(
        new Uint8Array(generateHwpx(readPlan(db), templateBytes)),
        { headers: {
          "Content-Type": "application/hwp+zip",
          "Content-Disposition": "attachment; filename=\"weekly-plan.hwpx\"",
        } },
      );
      if (path === "/api/items" && method === "POST") {
        const input = await body(request);
        const departmentId = text(input.departmentId, "소속 처");
        if (departmentId !== person.departmentId) throw new ApiFailure(403, "본인 소속 처에만 항목을 만들 수 있습니다.");
        if (!categories.includes(input.category as WorkCategory)) throw new ApiFailure(400, "업무 구분이 올바르지 않습니다.");
        const category = input.category as WorkCategory;
        const id = crypto.randomUUID();
        const item: WorkItem = { id, title: [], content: [], notes: [], tables: [], assignee: "" };
        db.transaction(() => {
          const section = db.query<{ id: number }, [string]>(`SELECT s.id FROM sections s
            JOIN weeks w ON w.id = s.week_id WHERE s.department_id = ? AND w.is_current = 1`).get(departmentId)!;
          db.query(`INSERT INTO items (id, section_id, category, position, content_json, status, creator_id)
            SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ?, '미작성', ? FROM items
            WHERE section_id = ? AND category = ?`).run(
            id, section.id, category, JSON.stringify(item), person.id, section.id, category,
          );
        })();
        return json(itemView(itemRow(id), person), 201);
      }
      const labelMatch = /^\/api\/departments\/([^/]+)\/label$/.exec(path);
      if (labelMatch && method === "PUT") {
        const departmentId = labelMatch[1], input = await body(request);
        if (person.departmentId !== departmentId) throw new ApiFailure(403, "본인 소속 처의 소제목만 바꿀 수 있습니다.");
        const thisWeek = text(input.thisWeek, "오른쪽 소제목");
        const section = db.query<{ id: number; labels_json: string }, [string]>(`SELECT s.id, s.labels_json
          FROM sections s JOIN weeks w ON w.id = s.week_id
          WHERE s.department_id = ? AND w.is_current = 1`).get(departmentId)!;
        const labels = { ...JSON.parse(section.labels_json), thisWeek };
        db.query("UPDATE sections SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels), section.id);
        return json({ departmentId, labels });
      }
      const match = /^\/api\/items\/([^/]+)(?:\/(assignment|lock))?$/.exec(path);
      if (match) {
        const id = match[1], action = match[2], row = itemRow(id);
        if (!action && method === "GET") return json(itemView(row, person));
        if (action === "assignment" && (method === "POST" || method === "DELETE")) {
          if (!canAssign(row.departmentId, person)) throw new ApiFailure(403, "소속 범위의 항목에만 본인을 할당할 수 있습니다.");
          db.transaction(() => {
            unlocked(id, person);
            if (method === "POST") db.query("INSERT OR IGNORE INTO assignments VALUES (?, ?)").run(id, person.id);
            else {
              db.query("DELETE FROM assignments WHERE item_id = ? AND person_id = ?").run(id, person.id);
              db.query("DELETE FROM edit_locks WHERE item_id = ? AND person_id = ?").run(id, person.id);
            }
            if (row.assigneeMode === "automatic") {
              const item: WorkItem = JSON.parse(row.content_json);
              item.assignee = automaticAssignee(id);
              db.query("UPDATE items SET content_json = ? WHERE id = ?").run(JSON.stringify(item), id);
            }
          })();
          return json(itemView(itemRow(id), person));
        }
        if (action === "lock" && (method === "POST" || method === "DELETE")) {
          editable(row, person);
          db.transaction(() => {
            unlocked(id, person);
            if (method === "POST") db.query(`INSERT INTO edit_locks VALUES (?, ?, ?)
              ON CONFLICT(item_id) DO UPDATE SET person_id = excluded.person_id, expires_at = excluded.expires_at`)
              .run(id, person.id, now() + lockIdleMs);
            else db.query("DELETE FROM edit_locks WHERE item_id = ? AND person_id = ?").run(id, person.id);
          })();
          return json(itemView(row, person));
        }
        if (!action && method === "PUT") {
          const input = saveInput(await body(request));
          editable(row, person);
          db.transaction(() => {
            if (!unlocked(id, person)) throw new ApiFailure(409, "편집 잠금을 먼저 확보하세요.", { code: "LOCK_REQUIRED" });
            const previous: WorkItem = JSON.parse(row.content_json);
            const assigneeMode = input.assignee === undefined ? row.assigneeMode :
              input.assignee === null ? "automatic" : "manual";
            const item: WorkItem = {
              id, title: input.title, content: input.content, notes: input.notes, tables: input.tables,
              assignee: input.assignee === undefined ? previous.assignee :
                input.assignee === null ? automaticAssignee(id) : input.assignee,
            };
            const hasContent = [...item.title, ...item.content.flat(), ...item.notes.flat()]
              .some((span) => span.text.trim()) || item.tables.length > 0;
            const status = row.status === "미작성" && hasContent ? "작성 중" : row.status;
            db.query("UPDATE items SET content_json = ?, status = ?, assignee_mode = ? WHERE id = ?")
              .run(JSON.stringify(item), status, assigneeMode, id);
            db.query("UPDATE edit_locks SET expires_at = ? WHERE item_id = ? AND person_id = ?")
              .run(now() + lockIdleMs, id, person.id);
          })();
          return json(itemView(itemRow(id), person));
        }
      }
      throw new ApiFailure(404, "요청한 경로가 없습니다.");
    } catch (error) {
      if (error instanceof ApiFailure) return json({ error: error.message, ...error.extra }, error.status);
      console.error(error);
      return json({ error: "서버 오류가 발생했습니다." }, 500);
    }
  };
}
