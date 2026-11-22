import type { Database } from "bun:sqlite";
import type { EditLock, ItemAction, ItemStatus, ItemView, Person, WeekView } from "../shared/api";
import { categories, type WorkCategory, type WorkItem } from "../shared/weekly-plan";
import { organisations, people, personColumns, readPlan } from "./database";
import { generateHwpx } from "./hwpx";
import { createReview } from "./review";
import { createPublishing } from "./publishing";
import { createRecords, itemHistory, sectionHistory } from "./records";
import { ApiFailure, object, saveInput, text } from "./validation";
import { readTemplate } from "./template";
import { bodyContentWidth, templateTableStyles } from "./table-style";
import { validateTableLayout } from "../shared/table-validation";

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

function hwpxHeaders(title: string) {
  const name = title.replace(/\s*<([^>]*)>/, (_, period: string) => `(${period.replace(/\s/g, "")})`);
  return {
    "Content-Type": "application/hwp+zip",
    "Content-Disposition": `attachment; filename="weekly-plan.hwpx"; filename*=UTF-8''${encodeURIComponent(`${name}.hwpx`)}`,
  };
}

export function createApp({ db, templateBytes, now = Date.now }: {
  db: Database;
  templateBytes: Uint8Array;
  now?: () => number;
}) {
  const review = createReview(db, now);
  const publishing = createPublishing(db, templateBytes, now);
  const template = readTemplate(templateBytes), tableStyles = templateTableStyles(template);
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
      FROM items i JOIN sections s ON s.id = i.section_id WHERE i.id = ?`).get(id);
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
      throw new ApiFailure(403, "지정된 담당자만 편집할 수 있습니다.");
  }
  function unlocked(id: string, person: Person): EditLock | null {
    const current = lock(id);
    if (current && current.personId !== person.id) throw new ApiFailure(423, current.message, { lock: current });
    return current;
  }
  function itemView(row: ItemRow, person: Person): ItemView {
    const assigned = assignedPeople(row.id), currentLock = lock(row.id);
    const visible = review.inScope(row.departmentId, person);
    const content: WorkItem = visible ? JSON.parse(row.content_json) :
      { id: row.id, title: [], content: [], notes: [], tables: [], assignee: "" };
    return {
      ...content, departmentId: row.departmentId, category: row.category,
      status: row.status, creatorId: visible ? row.creatorId : null,
      assignedPeople: visible ? assigned : [], assigneeMode: row.assigneeMode,
      lock: visible ? currentLock : null, canEdit: row.status !== "검토 요청" &&
        assigned.some((assigned) => assigned.id === person.id) &&
        (!currentLock || currentLock.personId === person.id),
      actions: visible ? review.actions(row.id, person) : [],
      review: visible ? review.itemReview(row.id) : { version: null, messages: [] },
    };
  }
  function automaticAssignee(id: string): string {
    return assignedPeople(id).map((person) => `${person.name} ${person.title}`).join(", ");
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
      const url = new URL(request.url), path = url.pathname, method = request.method;
      if (path === "/api/accounts" && method === "GET") return json(people(db));
      if (path === "/api/organisations" && method === "GET") return json(organisations(db));
      if (path === "/api/session" && method === "POST") {
        const input = await body(request);
        const name = text(input.name, "이름"), employeeNumber = text(input.employeeNumber, "사번");
        let person = people(db).find((person) => person.employeeNumber === employeeNumber);
        if (person && person.name !== name) throw new ApiFailure(400, "이름과 사번이 일치하지 않습니다.");
        if (!person) {
          if (!input.departmentId || !input.title)
            throw new ApiFailure(400, "처음 로그인할 때 소속 처와 직급을 입력하세요.", { code: "PROFILE_REQUIRED" });
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
      if (!person) throw new ApiFailure(401, "먼저 로그인하세요.");
      if (path === "/api/session" && method === "DELETE") {
        const token = /(?:^|;\s*)lx_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")![1];
        db.transaction(() => {
          db.query("DELETE FROM edit_locks WHERE person_id = ?").run(person.id);
          db.query("DELETE FROM sessions WHERE token = ?").run(token);
        })();
        return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", true) } });
      }
      if (path === "/api/weeks" && method === "GET") return json(publishing.weeks());
      if (path === "/api/board" && method === "GET") return json(publishing.posts());
      const postMatch = /^\/api\/board\/([1-9]\d*)(\/hwpx)?$/.exec(path);
      if (postMatch && method === "GET") {
        const id = Number(postMatch[1]);
        if (!postMatch[2]) return json(publishing.post(id));
        return new Response(new Uint8Array(publishing.download(id)), { headers: hwpxHeaders(publishing.post(id).title) });
      }
      const publishMatch = /^\/api\/weeks\/([1-9]\d*)\/(publish|open-next)$/.exec(path);
      if (publishMatch && method === "POST") {
        const id = Number(publishMatch[1]);
        return publishMatch[2] === "publish" ? json(publishing.publish(id, person), 201) :
          json(publishing.openNext(id, person));
      }
      const selectedId = url.searchParams.get("weekId");
      if (selectedId !== null && !/^[1-9]\d*$/.test(selectedId))
        throw new ApiFailure(400, "주차 ID가 올바르지 않습니다.");
      const week = publishing.week(selectedId === null ? undefined : Number(selectedId));
      const weekReview = createReview(db, now, week.id);
      const records = createRecords(db, now, week);
      if (path === "/api/deadline" && method === "GET") return json(records.deadline(person));
      if (path === "/api/deadline" && method === "PUT")
        return json(records.changeDeadline((await body(request)).deadlineAt, person));
      if (path === "/api/statistics" && method === "GET") return json(records.statistics(person));
      const sectionHistoryMatch = /^\/api\/sections\/([^/]+)\/history$/.exec(path);
      if (sectionHistoryMatch && method === "GET") {
        const departmentId = sectionHistoryMatch[1];
        if (!db.query("SELECT id FROM sections WHERE department_id = ? AND week_id = ?").get(departmentId, week.id))
          throw new ApiFailure(404, "처를 찾을 수 없습니다.");
        if (!review.inScope(departmentId, person)) throw new ApiFailure(403, "소속 범위의 이력만 열람할 수 있습니다.");
        return json(sectionHistory(db, departmentId, week.id));
      }
      const historyMatch = /^\/api\/items\/([^/]+)\/history$/.exec(path);
      if (historyMatch && method === "GET") {
        const row = itemRow(historyMatch[1]);
        if (!review.inScope(row.departmentId, person)) throw new ApiFailure(403, "소속 범위의 항목 이력만 열람할 수 있습니다.");
        return json(itemHistory(db, row.id));
      }
      if (path === "/api/dashboard" && method === "GET") return json(weekReview.dashboard(person));
      if (path === "/api/todos" && method === "GET") return json(weekReview.todos(person));
      if (path === "/api/week" && method === "GET") {
        const plan = readPlan(db, week.id);
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
      if (path === "/api/week/hwpx" && method === "GET") {
        const plan = readPlan(db, week.id), organisationId = url.searchParams.get("organisationId");
        let scope = "";
        if (organisationId !== null) {
          const units = organisations(db), unit = units.find((unit) => unit.id === organisationId);
          if (!unit) throw new ApiFailure(404, "조직을 찾을 수 없습니다.");
          if (unit.kind === "headquarters") throw new ApiFailure(400, "처 또는 실을 선택하세요.");
          if (!review.inScope(unit.id, person)) throw new ApiFailure(403, "본인 소속 범위만 출력할 수 있습니다.");
          plan.departments = plan.departments.filter((department) => unit.kind === "department" ?
            department.id === unit.id : units.find((candidate) => candidate.id === department.id)?.parentId === unit.id);
          scope = ` ${unit.name}`;
        }
        return new Response(new Uint8Array(generateHwpx(plan, templateBytes)), {
          headers: hwpxHeaders(`${plan.title} ${plan.titlePeriod}${scope}`),
        });
      }
      if (path === "/api/items" && method === "POST") {
        const input = await body(request);
        const departmentId = text(input.departmentId, "소속 처");
        if (departmentId !== person.departmentId) throw new ApiFailure(403, "본인 소속 처에만 항목을 만들 수 있습니다.");
        if (!categories.includes(input.category as WorkCategory)) throw new ApiFailure(400, "업무 구분이 올바르지 않습니다.");
        const category = input.category as WorkCategory;
        const id = crypto.randomUUID();
        const item: WorkItem = { id, title: [], content: [], notes: [], tables: [], assignee: "" };
        db.transaction(() => {
          const section = db.query<{ id: number }, [string, number]>(`SELECT s.id FROM sections s
            WHERE s.department_id = ? AND s.week_id = ?`).get(departmentId, week.id)!;
          db.query(`INSERT INTO items (id, section_id, category, position, content_json, status, creator_id)
            SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ?, '미작성', ? FROM items
            WHERE section_id = ? AND category = ?`).run(
            id, section.id, category, JSON.stringify(item), person.id, section.id, category,
          );
          review.invalidate(section.id);
        })();
        return json(itemView(itemRow(id), person), 201);
      }
      const labelMatch = /^\/api\/departments\/([^/]+)\/label$/.exec(path);
      if (labelMatch && method === "PUT") {
        const departmentId = labelMatch[1], input = await body(request);
        if (person.departmentId !== departmentId) throw new ApiFailure(403, "본인 소속 처의 소제목만 바꿀 수 있습니다.");
        const thisWeek = text(input.thisWeek, "금주 계획 소제목");
        const section = db.query<{ id: number; labels_json: string }, [string, number]>(`SELECT s.id, s.labels_json
          FROM sections s WHERE s.department_id = ? AND s.week_id = ?`).get(departmentId, week.id)!;
        const labels = { ...JSON.parse(section.labels_json), thisWeek };
        db.transaction(() => {
          if (JSON.stringify(labels) !== section.labels_json) review.invalidate(section.id);
          db.query("UPDATE sections SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels), section.id);
        })();
        return json({ departmentId, labels });
      }
      const reviewMatch = /^\/api\/items\/([^/]+)\/(request-review|withdraw|approve|return)$/.exec(path);
      if (reviewMatch && method === "POST") {
        const [, id, action] = reviewMatch;
        const input = (action === "return" || action === "request-review") && request.body ? await body(request) : {};
        review.itemAction(id, action as ItemAction, person, input);
        return json(itemView(itemRow(id), person));
      }
      const stageMatch = /^\/api\/review-stages\/([1-9]\d*)\/submit$/.exec(path);
      if (stageMatch && method === "POST") {
        weekReview.submit(Number(stageMatch[1]), person);
        return json(weekReview.dashboard(person));
      }
      const sectionMatch = /^\/api\/review-stages\/([1-9]\d*)\/sections\/([^/]+)\/(approve|return)$/.exec(path);
      if (sectionMatch && method === "POST") {
        weekReview.decideSection(Number(sectionMatch[1]), sectionMatch[2], sectionMatch[3] as "approve" | "return",
          person, sectionMatch[3] === "return" ? await body(request) : {});
        return json(weekReview.dashboard(person));
      }
      const match = /^\/api\/items\/([^/]+)(?:\/(assignment|lock))?$/.exec(path);
      if (match) {
        const id = match[1], action = match[2], row = itemRow(id);
        if (!action && method === "GET") {
          if (!review.inScope(row.departmentId, person)) throw new ApiFailure(403, "소속 범위의 항목만 열람할 수 있습니다.");
          return json(itemView(row, person));
        }
        if (action === "assignment" && (method === "POST" || method === "DELETE")) {
          if (!review.inScope(row.departmentId, person)) throw new ApiFailure(403, "소속 범위의 항목에만 본인을 담당자로 지정할 수 있습니다.");
          if (row.status === "검토 요청") throw new ApiFailure(409, "검토 요청을 회수한 뒤 담당자를 바꾸세요.");
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
              if (JSON.stringify(item) !== row.content_json) review.contentChanged(id);
              db.query("UPDATE items SET content_json = ? WHERE id = ?").run(JSON.stringify(item), id);
            }
          })();
          return json(itemView(itemRow(id), person));
        }
        if (action === "lock" && (method === "POST" || method === "DELETE")) {
          editable(row, person);
          if (method === "POST" && row.status === "검토 요청")
            throw new ApiFailure(409, "검토 요청을 회수한 뒤 편집하세요.");
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
          if (row.status === "검토 요청") throw new ApiFailure(409, "검토 요청을 회수한 뒤 수정하세요.");
          db.transaction(() => {
            if (!unlocked(id, person)) throw new ApiFailure(409, "편집 잠금을 먼저 확보하세요.", { code: "LOCK_REQUIRED" });
            const previous: WorkItem = JSON.parse(row.content_json);
            const department = template.departments.find(department => department.data.id === row.departmentId) ?? template.departments[0];
            const source = template.items.get(previous.templateItemId ?? previous.id) ??
              template.items.get(department.data.items[row.category][0].id)!;
            try { validateTableLayout(input.tables, bodyContentWidth(source,input.tables.some(table=>!tableStyles.tables[table.id])?
              tableStyles.inline.bodyMargin:undefined), tableStyles); } catch (error) {
              if (error instanceof Error) throw new ApiFailure(400, error.message);
              throw error;
            }
            const assigneeMode = input.assignee === undefined ? row.assigneeMode :
              input.assignee === null ? "automatic" : "manual";
            const item: WorkItem = {
              id, ...(previous.templateItemId ? { templateItemId: previous.templateItemId } : {}),
              title: input.title, content: input.content, notes: input.notes, tables: input.tables,
              assignee: input.assignee === undefined ? previous.assignee :
                input.assignee === null ? automaticAssignee(id) : input.assignee,
            };
            const hasContent = [...item.title, ...item.content.flat(), ...item.notes.flat()]
              .some((span) => span.text.trim()) || item.tables.length > 0;
            if (JSON.stringify(item) !== row.content_json) review.contentChanged(id);
            const currentStatus = itemRow(id).status;
            const status = currentStatus === "미작성" && hasContent ? "작성 중" : currentStatus;
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
