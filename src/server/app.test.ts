import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { ApiError, ItemView, Organisation, Person, SaveItemRequest, WeekView } from "../shared/api";
import { seed } from "../shared/seed";
import { createApp, lockIdleMs } from "./app";
import { openDatabase, readPlan } from "./database";
import { demoAccounts } from "./demo-accounts";
import { generateHwpx } from "./hwpx";

const templateBytes = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const departmentId = seed.departments[0].id;
const otherDepartmentId = seed.departments[1].id;
const blank: SaveItemRequest = { title: [], content: [], notes: [], tables: [] };
const content: SaveItemRequest = {
  title: [{ text: "새 업무", bold: true, color: "blue" }],
  content: [[{ text: " ○ 새 본문" }]], notes: [[{ text: " * 참고", color: "red" }]], tables: [],
};

let directory: string;
let db: Database;
let handler: ReturnType<typeof createApp>;
let clock: number;
let first: string;
let second: string;

async function call<T = ItemView>(method: string, path: string, cookie = "", data?: unknown) {
  const response = await handler(new Request(`http://localhost${path}`, {
    method, headers: { cookie, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
  return { response, data: response.status === 204 ? null as T : await response.json() as T };
}
async function login(employeeNumber: string): Promise<string> {
  const account = demoAccounts.find((account) => account.employeeNumber === employeeNumber)!;
  const { response } = await call("POST", "/api/session", "", account);
  if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status}`);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function create(cookie = first, category = "thisWeek"): Promise<ItemView> {
  const result = await call("POST", "/api/items", cookie, { departmentId, category });
  if (result.response.status !== 201) throw new Error(`Create failed: ${result.response.status}`);
  return result.data;
}
async function prepare(twoPeople = false): Promise<ItemView> {
  const item = await create();
  await call("POST", `/api/items/${item.id}/assignment`, first);
  if (twoPeople) await call("POST", `/api/items/${item.id}/assignment`, second);
  await call("POST", `/api/items/${item.id}/lock`, first);
  return item;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "lx-api-test-"));
  db = openDatabase(join(directory, "test.sqlite"));
  clock = 1_800_000_000_000;
  handler = createApp({ db, templateBytes, now: () => clock });
  first = await login("W1001");
  second = await login("W1002");
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("seed and startup", () => {
  test("an existing database gains version notes while retaining its submissions", async () => {
    const item = await prepare();
    await call("PUT", `/api/items/${item.id}`, first, content);
    await call("POST", `/api/items/${item.id}/request-review`, first);
    db.exec("ALTER TABLE item_versions DROP COLUMN note");
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    handler = createApp({ db, templateBytes, now: () => clock });
    const result = await call("GET", `/api/items/${item.id}`, first);
    expect(result.data.review.version).toMatchObject({ number: 1, note: null, content: { title: content.title } });
  });
  test.each([undefined, "", " \n "])("a resubmission with an empty note (%j) stores no note", async (note) => {
    const item = await prepare();
    await call("PUT", `/api/items/${item.id}`, first, content);
    await call("POST", `/api/items/${item.id}/request-review`, first);
    await call("POST", `/api/items/${item.id}/withdraw`, first);
    const result = await call("POST", `/api/items/${item.id}/request-review`, first, { note });
    expect(result.response.status).toBe(200);
    expect(result.data.review.version).toMatchObject({ number: 2, note: null });
  });
  test("a resubmission rejects a note of the wrong type without adding a version", async () => {
    const item = await prepare();
    await call("PUT", `/api/items/${item.id}`, first, content);
    expect((await call("POST", `/api/items/${item.id}/request-review`, first, { note: 2 })).response.status).toBe(400);
    expect((await call("GET", `/api/items/${item.id}`, first)).data.review.version).toBeNull();
    await call("POST", `/api/items/${item.id}/request-review`, first);
    await call("POST", `/api/items/${item.id}/withdraw`, first);
    expect((await call("POST", `/api/items/${item.id}/request-review`, first, { note: 2 })).response.status).toBe(400);
    expect((await call("GET", `/api/items/${item.id}`, first)).data.review.version?.number).toBe(1);
  });
  test("database round-trips the exact generator input", () => {
    expect(readPlan(db)).toEqual(seed);
  });
  test("database export section XML equals the seed export", () => {
    const section = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["Contents/section0.xml"]);
    expect(section(generateHwpx(readPlan(db), templateBytes))).toBe(section(generateHwpx(seed, templateBytes)));
  });
  test("reopening the database does not import a second week", () => {
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    expect(db.query("SELECT COUNT(*) AS count FROM weeks").get()).toEqual({ count: 1 });
  });
  test("the direct department review stage points to headquarters using data", () => {
    const result = db.query(`SELECT parent.organisation_id AS parent FROM review_stages stage
      JOIN review_stages parent ON parent.id = stage.parent_stage_id WHERE stage.organisation_id = ?`)
      .get(seed.departments[4].id);
    expect(result).toEqual({ parent: "headquarters" });
  });
  test("the item status column accepts exactly the five specified states", () => {
    const sql = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'items'").get()!.sql;
    expect(sql).toContain("'미작성','작성 중','검토 요청','수정 요청','승인'");
  });
});

describe("sign-in and accounts", () => {
  test("the account switcher lists all preregistered demo people", async () => {
    expect((await call<Person[]>("GET", "/api/accounts")).data).toHaveLength(23);
  });
  test("organisation rows expose the hierarchy and order", async () => {
    expect((await call<Organisation[]>("GET", "/api/organisations")).data.map((unit) => unit.kind))
      .toEqual(["headquarters", "office", "office", "department", "department", "department", "department", "department"]);
  });
  test("name and employee number establish a cookie session", async () => {
    expect((await call<{ person: Person }>("GET", "/api/session", first)).data.person.employeeNumber).toBe("W1001");
  });
  test("existing accounts reject a different name", async () => {
    expect((await call("POST", "/api/session", "", { employeeNumber: "W1001", name: "다른이름" })).response.status).toBe(400);
  });
  test("first sign-in asks for department and title", async () => {
    expect((await call<ApiError>("POST", "/api/session", "", { employeeNumber: "NEW1", name: "새사용자" })).data.code)
      .toBe("PROFILE_REQUIRED");
  });
  test("first sign-in registers a writer in the chosen department", async () => {
    const result = await call<{ person: Person }>("POST", "/api/session", "", {
      employeeNumber: "NEW1", name: "새사용자", departmentId, title: "대리", role: "director",
    });
    expect(result.data.person).toMatchObject({ name: "새사용자", departmentId, title: "대리", role: "writer" });
  });
  test("first sign-in rejects an office in place of a department", async () => {
    expect((await call("POST", "/api/session", "", {
      employeeNumber: "NEW1", name: "새사용자", departmentId: "office-planning", title: "대리",
    })).response.status).toBe(400);
  });
  test("anonymous requests cannot read the writing data", async () => {
    expect((await call("GET", "/api/week")).response.status).toBe(401);
  });
  test("sign-out invalidates the current cookie", async () => {
    await call("DELETE", "/api/session", first);
    expect((await call<{ person: Person | null }>("GET", "/api/session", first)).data.person).toBeNull();
  });
  test("switching accounts in one browser invalidates the previous cookie", async () => {
    await call("POST", "/api/session", first, { employeeNumber: "W1002", name: "방지원" });
    expect((await call<{ person: Person | null }>("GET", "/api/session", first)).data.person).toBeNull();
  });
});

describe("items and assignment", () => {
  test("the week response includes every department and all three categories", async () => {
    const week = (await call<WeekView>("GET", "/api/week", first)).data;
    expect(week.departments.map((department) => Object.keys(department.items)))
      .toEqual(seed.departments.map(() => ["lastWeek", "thisWeek", "ongoing"]));
  });
  test.each(["lastWeek", "thisWeek", "ongoing"])("creates an item in %s with no saved content", async (category) => {
    expect(await create(first, category)).toMatchObject({ category, departmentId, status: "미작성", creatorId: 5 });
  });
  test("new items append to their category without storing a visible number", async () => {
    const item = await create();
    const week = (await call<WeekView>("GET", "/api/week", first)).data;
    expect(week.departments[0].items.thisWeek.at(-1)).toMatchObject({ id: item.id, title: [] });
  });
  test("a person cannot create an item in another department", async () => {
    expect((await call("POST", "/api/items", first, { departmentId: otherDepartmentId, category: "ongoing" })).response.status)
      .toBe(403);
  });
  test("a person cannot create an item with an unknown category", async () => {
    expect((await call("POST", "/api/items", first, { departmentId, category: "invalid" })).response.status).toBe(400);
  });
  test("several people may assign themselves to the same item", async () => {
    const item = await create();
    await call("POST", `/api/items/${item.id}/assignment`, first);
    expect((await call("POST", `/api/items/${item.id}/assignment`, second)).data.assignedPeople.map((person) => person.name))
      .toEqual(["나현수", "방지원"]);
  });
  test("self assignment composes names and titles in assignment order", async () => {
    const item = await prepare(true);
    expect((await call("GET", `/api/items/${item.id}`, first)).data.assignee).toBe("나현수 책임, 방지원 선임");
  });
  test("assignment is idempotent", async () => {
    const item = await prepare();
    expect((await call("POST", `/api/items/${item.id}/assignment`, first)).data.assignedPeople).toHaveLength(1);
  });
  test("self unassignment removes that person's name", async () => {
    const item = await prepare(true);
    expect((await call("DELETE", `/api/items/${item.id}/assignment`, first)).data.assignee).toBe("방지원 선임");
  });
  test("writers cannot self assign in another department", async () => {
    expect((await call("POST", `/api/items/${seed.departments[1].items.lastWeek[0].id}/assignment`, first)).response.status)
      .toBe(403);
  });
  test("office reviewers may be assigned writers within their own office", async () => {
    const reviewer = await login("O0001"), item = await create();
    expect((await call("POST", `/api/items/${item.id}/assignment`, reviewer)).data.assignedPeople[0].role).toBe("officeReviewer");
  });
  test("office reviewers cannot self assign outside their office", async () => {
    const reviewer = await login("O0001");
    expect((await call("POST", `/api/items/${seed.departments[2].items.lastWeek[0].id}/assignment`, reviewer)).response.status)
      .toBe(403);
  });
  test("the definition does not authorize deletion, so there is no delete-item route", async () => {
    const item = await create();
    expect((await call("DELETE", `/api/items/${item.id}`, first)).response.status).toBe(404);
  });
  test("the right-hand label can be changed by department members", async () => {
    await call("PUT", `/api/departments/${departmentId}/label`, first, { thisWeek: "□ 새 주간업무" });
    expect(readPlan(db).departments[0].labels.thisWeek).toBe("□ 새 주간업무");
  });
  test("the right-hand label cannot be changed by another department", async () => {
    expect((await call("PUT", `/api/departments/${otherDepartmentId}/label`, first, { thisWeek: "변경" })).response.status).toBe(403);
  });
});

describe("editing and interim saves", () => {
  test("only assigned people can acquire an edit lock", async () => {
    const item = await create();
    expect((await call("POST", `/api/items/${item.id}/lock`, first)).response.status).toBe(403);
  });
  test("only assigned people can save an item", async () => {
    const item = await create();
    expect((await call("PUT", `/api/items/${item.id}`, first, content)).response.status).toBe(403);
  });
  test("an assigned person must acquire the lock before saving", async () => {
    const item = await create();
    await call("POST", `/api/items/${item.id}/assignment`, first);
    expect((await call<ApiError>("PUT", `/api/items/${item.id}`, first, content)).data.code).toBe("LOCK_REQUIRED");
  });
  test("a save retains title, content, notes, tables, emphasis and free assignee text", async () => {
    const item = await prepare();
    const saved = { ...content, tables: structuredClone(seed.departments[1].items.ongoing[2].tables), assignee: "예산팀 전원" };
    expect((await call("PUT", `/api/items/${item.id}`, first, saved)).data).toMatchObject(saved);
  });
  test("first saved content changes 미작성 to 작성 중", async () => {
    const item = await prepare();
    expect((await call("PUT", `/api/items/${item.id}`, first, content)).data.status).toBe("작성 중");
  });
  test("saving an empty item keeps 미작성", async () => {
    const item = await prepare();
    expect((await call("PUT", `/api/items/${item.id}`, first, blank)).data.status).toBe("미작성");
  });
  test("assignee text alone is not saved work content", async () => {
    const item = await prepare();
    expect((await call("PUT", `/api/items/${item.id}`, first, { ...blank, assignee: "담당자" })).data.status).toBe("미작성");
  });
  test("clearing a previously saved item does not add a reverse transition", async () => {
    const item = await prepare();
    await call("PUT", `/api/items/${item.id}`, first, content);
    expect((await call("PUT", `/api/items/${item.id}`, first, blank)).data.status).toBe("작성 중");
  });
  test("a manually overridden assignee persists when membership changes", async () => {
    const item = await prepare();
    await call("PUT", `/api/items/${item.id}`, first, { ...content, assignee: "기획팀 전원" });
    await call("DELETE", `/api/items/${item.id}/lock`, first);
    expect((await call("POST", `/api/items/${item.id}/assignment`, second)).data.assignee).toBe("기획팀 전원");
  });
  test("null assignee returns to automatic composition", async () => {
    const item = await prepare(true);
    await call("PUT", `/api/items/${item.id}`, first, { ...content, assignee: "직접 입력" });
    expect((await call("PUT", `/api/items/${item.id}`, first, { ...content, assignee: null })).data.assignee)
      .toBe("나현수 책임, 방지원 선임");
  });
  test("invalid formatting is rejected at the API boundary", async () => {
    const item = await prepare();
    expect((await call("PUT", `/api/items/${item.id}`, first, { ...content, title: [{ text: "제목", color: "green" }] }))
      .response.status).toBe(400);
  });
  test("overlapping table cells are rejected before saving", async () => {
    const item = await prepare(), tables = structuredClone(seed.departments[1].items.ongoing[2].tables);
    tables[0].cells[0].colSpan = 3;
    expect((await call("PUT", `/api/items/${item.id}`, first, { ...content, tables })).response.status).toBe(400);
  });
  test("client-supplied status does not perform a review transition", async () => {
    const item = await prepare();
    expect((await call("PUT", `/api/items/${item.id}`, first, { ...content, status: "승인" })).data.status).toBe("작성 중");
  });
});

describe("edit locks with an injected clock", () => {
  test("other assigned people see the lock owner's name and read-only state", async () => {
    const item = await prepare(true);
    expect((await call("GET", `/api/items/${item.id}`, second)).data).toMatchObject({
      canEdit: false, lock: { name: "나현수", message: "나현수 편집 중", expiresAt: clock + lockIdleMs },
    });
  });
  test("another assigned person cannot acquire a live lock", async () => {
    const item = await prepare(true);
    expect((await call("POST", `/api/items/${item.id}/lock`, second)).response.status).toBe(423);
  });
  test("another assigned person cannot save through a live lock", async () => {
    const item = await prepare(true);
    expect((await call("PUT", `/api/items/${item.id}`, second, content)).response.status).toBe(423);
  });
  test("another assigned person cannot release a live lock", async () => {
    const item = await prepare(true);
    expect((await call("DELETE", `/api/items/${item.id}/lock`, second)).response.status).toBe(423);
  });
  test("assignment changes cannot overwrite automatic text during another person's edit", async () => {
    const item = await prepare(true);
    expect((await call("DELETE", `/api/items/${item.id}/assignment`, second)).response.status).toBe(423);
  });
  test("the lock owner can renew the idle timeout", async () => {
    const item = await prepare();
    clock += 30_000;
    expect((await call("POST", `/api/items/${item.id}/lock`, first)).data.lock?.expiresAt).toBe(clock + lockIdleMs);
  });
  test("saving also renews the idle timeout", async () => {
    const item = await prepare();
    clock += 30_000;
    expect((await call("PUT", `/api/items/${item.id}`, first, content)).data.lock?.expiresAt).toBe(clock + lockIdleMs);
  });
  test("a released lock can be acquired by another assigned person", async () => {
    const item = await prepare(true);
    await call("DELETE", `/api/items/${item.id}/lock`, first);
    expect((await call("POST", `/api/items/${item.id}/lock`, second)).data.lock?.name).toBe("방지원");
  });
  test("an expired lock can be acquired without sleeping", async () => {
    const item = await prepare(true);
    clock += lockIdleMs;
    expect((await call("POST", `/api/items/${item.id}/lock`, second)).data.lock?.name).toBe("방지원");
  });
  test("an expired lock cannot be used to save", async () => {
    const item = await prepare();
    clock += lockIdleMs;
    expect((await call<ApiError>("PUT", `/api/items/${item.id}`, first, content)).data.code).toBe("LOCK_REQUIRED");
  });
  test("self unassignment releases the owner's lock", async () => {
    const item = await prepare(true);
    expect((await call("DELETE", `/api/items/${item.id}/assignment`, first)).data.lock).toBeNull();
  });
  test("account switching releases the old person's locks", async () => {
    const item = await prepare(true);
    await call("POST", "/api/session", first, { employeeNumber: "W1002", name: "방지원" });
    expect((await call("POST", `/api/items/${item.id}/lock`, second)).data.lock?.name).toBe("방지원");
  });
});

test("the real download handler returns a zip starting with mimetype", async () => {
  const response = await handler(new Request("http://localhost/api/week/hwpx", { headers: { cookie: first } }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(strFromU8(bytes.subarray(30, 38))).toBe("mimetype");
  const disposition = response.headers.get("Content-Disposition")!;
  expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toMatch(/^기획혁신본부 주간업무 계획\(\d+\.\d+\.~\d+\.\d+\.\)\.hwpx$/);
});
