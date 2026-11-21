import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardView, ItemView, SaveItemRequest, TodoView, WeekView } from "../shared/api";
import { seed } from "../shared/seed";
import { createApp } from "./app";
import { openDatabase } from "./database";
import { demoAccounts } from "./demo-accounts";

const templateBytes = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const department = seed.departments[0].id;
const otherDepartment = seed.departments[1].id;
// The eighth source item, as requested for the end-to-end demonstration.
const item8 = seed.departments[0].items.ongoing[1].id;
const sibling = seed.departments[0].items.lastWeek[0].id;
const content: SaveItemRequest = { title: [{ text: "검토할 업무" }], content: [[{ text: " ○ 변경한 내용" }]], notes: [], tables: [] };
let directory: string;
let db: Database;
let handler: ReturnType<typeof createApp>;
let clock: number;
let cookies: Map<string, string>;

async function call<T = ItemView>(method: string, path: string, account = "W1001", data?: unknown) {
  if (account && !cookies.has(account)) {
    const demo = demoAccounts.find((person) => person.employeeNumber === account)!;
    const response = await handler(new Request("http://localhost/api/session", {
      method: "POST", body: JSON.stringify(demo), headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(200);
    cookies.set(account, response.headers.get("set-cookie")!.split(";")[0]);
  }
  const response = await handler(new Request(`http://localhost${path}`, {
    method, headers: { cookie: cookies.get(account) ?? "", "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
  return { status: response.status, data: await response.json() as T };
}
async function ok<T = ItemView>(method: string, path: string, account = "W1001", data?: unknown) {
  const result = await call<T>(method, path, account, data);
  expect(result.status).toBe(200);
  return result.data;
}
const action = (id: string, name: string, account = "W1001", data?: unknown) =>
  ok("POST", `/api/items/${id}/${name}`, account, data);
function stage(organisationId: string): number {
  return db.query<{ id: number }, [string]>("SELECT id FROM review_stages WHERE organisation_id = ?").get(organisationId)!.id;
}
const submit = (organisationId: string, account: string) =>
  ok<DashboardView>("POST", `/api/review-stages/${stage(organisationId)}/submit`, account);
const sectionAction = (organisationId: string, departmentId: string, name: string, account: string, data?: unknown) =>
  ok<DashboardView>("POST", `/api/review-stages/${stage(organisationId)}/sections/${departmentId}/${name}`, account, data);
async function save(id = item8, account = "W1001", input = content): Promise<ItemView> {
  await action(id, "lock", account);
  return ok("PUT", `/api/items/${id}`, account, input);
}
async function request(id = item8, index = 0): Promise<ItemView> {
  const account = `W${index + 1}001`;
  await action(id, "assignment", account);
  return action(id, "request-review", account);
}
async function approveDepartment(index = 0): Promise<void> {
  const source = seed.departments[index];
  for (const item of Object.values(source.items).flat()) {
    const current = await ok("GET", `/api/items/${item.id}`, `W${index + 1}001`);
    if (current.status === "승인") continue;
    if (current.status !== "검토 요청") await request(item.id, index);
    await action(item.id, "approve", `R000${index + 1}`);
  }
}
async function approveOffice(): Promise<void> {
  for (const index of [0, 1]) {
    await approveDepartment(index);
    await submit(seed.departments[index].id, `R000${index + 1}`);
    await sectionAction("office-planning", seed.departments[index].id, "approve", "O0001");
  }
  await submit("office-planning", "O0001");
}
const dashboard = (account = "W1001") => ok<DashboardView>("GET", "/api/dashboard", account);
const todos = (account = "W1001") => ok<TodoView>("GET", "/api/todos", account);
const departmentView = (view: DashboardView, departmentId = department) =>
  view.departments.find((row) => row.departmentId === departmentId)!;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lx-review-test-"));
  db = openDatabase(join(directory, "test.sqlite"));
  clock = 1_800_000_000_000;
  cookies = new Map();
  handler = createApp({ db, templateBytes, now: () => clock });
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("item review states and fixed versions", () => {
  test("an existing U2 database gains review-unit data without replacing its items", () => {
    db.exec("ALTER TABLE review_stages DROP COLUMN review_unit");
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    handler = createApp({ db, templateBytes, now: () => clock });
    expect(db.query("SELECT review_unit FROM review_stages WHERE organisation_id = ?").get(department))
      .toEqual({ review_unit: "item" });
    expect(db.query("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 33 });
  });
  test("the full eighth-item path reaches final approval through return, resubmit and both compilations", async () => {
    await action(item8, "assignment");
    expect((await save()).status).toBe("작성 중");
    expect((await action(item8, "request-review")).status).toBe("검토 요청");
    clock += 100;
    const returned = await action(item8, "return", "R0001", { message: "근거를 보완하세요." });
    expect(returned.status).toBe("수정 요청");
    expect(returned.review.messages[0]).toMatchObject({
      versionId: returned.review.version!.id, at: clock, message: "근거를 보완하세요.",
      reviewUnit: "item", senderName: "최영수", senderTitle: "처장",
    });
    expect((await save(item8, "W1001", { ...content, notes: [[{ text: " * 보완 근거" }]] })).status).toBe("작성 중");
    const resubmitted = await action(item8, "request-review", "W1001", { note: "  근거를 보완했습니다.  " });
    expect(resubmitted.review.version).toMatchObject({ number: 2, note: "근거를 보완했습니다." });
    expect((await ok("GET", `/api/items/${item8}`, "R0001")).review.version?.note).toBe("근거를 보완했습니다.");
    expect((await action(item8, "approve", "R0001")).status).toBe("승인");
    await approveDepartment();
    const sent = await submit(department, "R0001");
    expect(departmentView(sent).reviews[0].status).toBe("검토 요청");
    await sectionAction("office-planning", department, "approve", "O0001");
    await approveDepartment(1);
    await submit(otherDepartment, "R0002");
    await sectionAction("office-planning", otherDepartment, "approve", "O0001");
    const upward = await submit("office-planning", "O0001");
    expect(departmentView(upward).reviews.at(-1)!.status).toBe("검토 요청");
    const final = await sectionAction("headquarters", department, "approve", "D0001");
    expect(departmentView(final).status).toBe("승인");
    expect(departmentView(final).reviews.every((row) => row.status === "승인")).toBe(true);
  });
  test("request review stores a full fixed snapshot with time and actor", async () => {
    await action(item8, "assignment");
    const current = await action(item8, "request-review", "W1001", { note: "첫 제출의 사유는 무시" });
    expect(current.review.version).toMatchObject({
      number: 1, requestedAt: clock, requestedBy: 5, content: { id: item8, title: current.title }, note: null,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM item_versions").get()).toEqual({ count: 1 });
  });
  test("interim saves do not create history versions", async () => {
    await action(item8, "assignment");
    await save();
    await save(item8, "W1001", { ...content, notes: [[{ text: "메모" }]] });
    expect(db.query("SELECT COUNT(*) AS count FROM item_versions").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM review_records").get()).toEqual({ count: 0 });
  });
  test("a requested item cannot be locked or edited before withdrawal", async () => {
    await request();
    expect((await call("POST", `/api/items/${item8}/lock`)).status).toBe(409);
    expect((await call("PUT", `/api/items/${item8}`, "W1001", content)).status).toBe(409);
    expect((await ok("GET", `/api/items/${item8}`)).canEdit).toBe(false);
  });
  test("a request releases its edit lock", async () => {
    await action(item8, "assignment");
    await save();
    expect((await action(item8, "request-review")).lock).toBeNull();
  });
  test("withdraw returns to writing while retaining the snapshot and recording its actor", async () => {
    const submitted = await request();
    clock += 100;
    const withdrawn = await action(item8, "withdraw");
    expect(withdrawn.status).toBe("작성 중");
    await save();
    expect((await ok("GET", `/api/items/${item8}`)).review.version!.content).toEqual(submitted.review.version!.content);
    expect(db.query("SELECT action, actor_id AS actor, at FROM review_records ORDER BY id DESC LIMIT 1").get())
      .toEqual({ action: "withdrawn", actor: 5, at: clock });
  });
  test("a return requires a nonblank message and leaves the version intact", async () => {
    const submitted = await request();
    expect((await call("POST", `/api/items/${item8}/return`, "R0001", { message: " " })).status).toBe(400);
    expect((await ok("GET", `/api/items/${item8}`)).review.version).toEqual(submitted.review.version);
  });
  test("a reviewer can return an item after approving it", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await action(item8, "return", "R0001", { message: "승인 후 추가 수정" })).status).toBe("수정 요청");
  });
  test("a writer can edit an approved item and request a new fixed version", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await save()).status).toBe("작성 중");
    const submitted = await action(item8, "request-review");
    expect(submitted.status).toBe("검토 요청");
    expect(submitted.review.version).toMatchObject({ number: 2, changed: true });
  });
  test("withdrawal and another request retain a revised item's change marker", async () => {
    await request();
    await action(item8, "approve", "R0001");
    await save();
    await action(item8, "request-review");
    await action(item8, "withdraw");
    expect((await action(item8, "request-review")).review.version).toMatchObject({ number: 3, changed: true });
  });
  test("a no-op save of approved content preserves approvals", async () => {
    await request();
    const approved = await action(item8, "approve", "R0001");
    const saved = await save(item8, "W1001", approved);
    expect(saved.status).toBe("승인");
  });
  test("an empty item cannot request review", async () => {
    const created = await call("POST", "/api/items", "W1001", { departmentId: department, category: "thisWeek" });
    expect(created.status).toBe(201);
    await action(created.data.id, "assignment");
    expect((await call("POST", `/api/items/${created.data.id}/request-review`)).status).toBe(409);
  });
  test("automatic assignee changes count as approved content changes", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await action(item8, "assignment", "W1002")).status).toBe("작성 중");
  });
  test("pending review prevents assignment text from changing the fixed content", async () => {
    const submitted = await request();
    expect((await call("POST", `/api/items/${item8}/assignment`, "W1002")).status).toBe(409);
    expect((await ok("GET", `/api/items/${item8}`)).assignee).toBe(submitted.assignee);
  });
});

describe("stage ordering and selective re-review", () => {
  test("a department cannot submit until every item is approved", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await call("POST", `/api/review-stages/${stage(department)}/submit`, "R0001")).status).toBe(409);
  });
  test("an office cannot approve before the department submits", async () => {
    await approveDepartment();
    expect((await call("POST", `/api/review-stages/${stage("office-planning")}/sections/${department}/approve`, "O0001")).status)
      .toBe(409);
  });
  test("an office cannot submit until every subordinate section is approved", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    await sectionAction("office-planning", department, "approve", "O0001");
    expect((await call("POST", `/api/review-stages/${stage("office-planning")}/submit`, "O0001")).status).toBe(409);
  });
  test("a final decider cannot approve before office submission", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    await sectionAction("office-planning", department, "approve", "O0001");
    expect((await call("POST", `/api/review-stages/${stage("headquarters")}/sections/${department}/approve`, "D0001")).status)
      .toBe(409);
  });
  test("a direct department goes to the final decider without an office stage", async () => {
    const direct = seed.departments[4].id;
    await approveDepartment(4);
    const view = await submit(direct, "R0005");
    expect(departmentView(view, direct).reviews.map((row) => row.stageId)).toEqual([stage("headquarters")]);
    expect(departmentView(await sectionAction("headquarters", direct, "approve", "D0001"), direct).status).toBe("승인");
  });
  test("changing a parent-stage row changes routing without a role or organisation branch", async () => {
    db.query("UPDATE review_stages SET parent_stage_id = ? WHERE organisation_id = ?").run(stage("headquarters"), department);
    await approveDepartment();
    const view = await submit(department, "R0001");
    expect(departmentView(view).reviews.map((row) => row.stageId)).toEqual([stage("headquarters")]);
  });
  test("the configured reviewer row determines who may approve", async () => {
    const replacement = db.query<{ id: number }, []>("SELECT id FROM people WHERE employee_number = 'R0002'").get()!.id;
    db.query("UPDATE review_stages SET reviewer_id = ? WHERE organisation_id = ?").run(replacement, department);
    await request();
    expect((await call("POST", `/api/items/${item8}/approve`, "R0001")).status).toBe(403);
    expect(departmentView(await dashboard("R0002")).items).toHaveLength(8);
    expect((await action(item8, "approve", "R0002")).status).toBe("승인");
  });
  test("editing approved content releases only its item and section at every upper stage", async () => {
    await approveOffice();
    await sectionAction("headquarters", department, "approve", "D0001");
    await sectionAction("headquarters", otherDepartment, "approve", "D0001");
    expect((await save()).status).toBe("작성 중");
    expect((await ok("GET", `/api/items/${sibling}`)).status).toBe("승인");
    let view = await dashboard("D0001");
    expect(departmentView(view).reviews.map((row) => row.status)).toEqual(["작성 중", "작성 중"]);
    expect(departmentView(view, otherDepartment).reviews.map((row) => row.status)).toEqual(["승인", "승인"]);
    await action(item8, "request-review");
    view = await dashboard("R0001");
    expect(departmentView(view).items.filter((row) => row.actions.includes("approve")).map((row) => row.id)).toEqual([item8]);
    expect(departmentView(view).items.find((row) => row.id === item8)!.changed).toBe(true);
    await action(item8, "approve", "R0001");
    await submit(department, "R0001");
    view = await dashboard("O0001");
    expect(departmentView(view).reviews[0].actions).toContain("approve");
    expect(departmentView(view, otherDepartment).reviews[0].actions).not.toContain("approve");
    await sectionAction("office-planning", department, "approve", "O0001");
    view = await submit("office-planning", "O0001");
    expect(departmentView(view).reviews.at(-1)!.status).toBe("검토 요청");
    expect(departmentView(view, otherDepartment).reviews.at(-1)!.status).toBe("승인");
  });
  test("an office returns a section by naming items and records the message against their versions", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    const versionId = (await ok("GET", `/api/items/${item8}`)).review.version!.id;
    await sectionAction("office-planning", department, "return", "O0001", { itemIds: [item8], message: "실 검토 보완" });
    expect((await ok("GET", `/api/items/${item8}`))).toMatchObject({
      status: "수정 요청", review: { messages: [{
        versionId, stageId: stage("office-planning"), message: "실 검토 보완",
        reviewUnit: "section", senderName: "서민철", senderTitle: "실장",
      }] },
    });
    expect((await ok("GET", `/api/items/${sibling}`)).status).toBe("승인");
  });
  test("an office can return an already approved section", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    await sectionAction("office-planning", department, "approve", "O0001");
    const view = await sectionAction("office-planning", department, "return", "O0001", { itemIds: [item8], message: "추가 확인" });
    expect(departmentView(view).reviews[0].status).toBe("수정 요청");
  });
  test("the final decider can return an approved section and only its named items", async () => {
    await approveOffice();
    await sectionAction("headquarters", department, "approve", "D0001");
    await sectionAction("headquarters", otherDepartment, "approve", "D0001");
    const view = await sectionAction("headquarters", department, "return", "D0001", { itemIds: [item8], message: "본부 보완" });
    expect(departmentView(view).reviews.map((row) => row.status)).toEqual(["작성 중", "수정 요청"]);
    expect(departmentView(view, otherDepartment).status).toBe("승인");
    expect((await ok("GET", `/api/items/${sibling}`)).status).toBe("승인");
    expect((await ok("GET", `/api/items/${item8}`)).review.messages.at(-1)!.message).toBe("본부 보완");
  });
  test("creating an item releases previous section approvals", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    await sectionAction("office-planning", department, "approve", "O0001");
    expect((await call("POST", "/api/items", "W1001", { departmentId: department, category: "ongoing" })).status).toBe(201);
    expect(departmentView(await dashboard("O0001")).reviews[0].status).toBe("작성 중");
  });
});

describe("authorisation and request boundaries", () => {
  test("anonymous clients cannot use dashboard, todos or review actions", async () => {
    for (const [method, path] of [["GET", "/api/dashboard"], ["GET", "/api/todos"], ["POST", `/api/items/${item8}/approve`]])
      expect((await call(method, path, "")).status).toBe(401);
  });
  test("an unassigned writer cannot request review or withdraw", async () => {
    expect((await call("POST", `/api/items/${item8}/request-review`)).status).toBe(403);
    await request();
    expect((await call("POST", `/api/items/${item8}/withdraw`, "W1002")).status).toBe(403);
  });
  test("a writer cannot approve or return an item", async () => {
    await request();
    expect((await call("POST", `/api/items/${item8}/approve`)).status).toBe(403);
    expect((await call("POST", `/api/items/${item8}/return`, "W1001", { message: "수정" })).status).toBe(403);
  });
  test("a department reviewer cannot review another department", async () => {
    await request();
    expect((await call("POST", `/api/items/${item8}/approve`, "R0002")).status).toBe(403);
  });
  test("an office reviewer and director cannot bypass item review", async () => {
    await request();
    for (const account of ["O0001", "D0001"])
      expect((await call("POST", `/api/items/${item8}/approve`, account)).status).toBe(403);
  });
  test("reviewers cannot submit another reviewer's compilation", async () => {
    expect((await call("POST", `/api/review-stages/${stage(department)}/submit`, "R0002")).status).toBe(403);
    expect((await call("POST", `/api/review-stages/${stage("office-planning")}/submit`, "W1001")).status).toBe(403);
  });
  test("an office reviewer cannot approve a section outside its scope", async () => {
    expect((await call("POST", `/api/review-stages/${stage("office-planning")}/sections/${seed.departments[2].id}/approve`, "O0001")).status)
      .toBe(403);
  });
  test("a section return must name at least one item and provide a message", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    const path = `/api/review-stages/${stage("office-planning")}/sections/${department}/return`;
    for (const data of [{ message: "수정", itemIds: [] }, { itemIds: [item8] }, { message: "수정", itemIds: [item8, item8] }])
      expect((await call("POST", path, "O0001", data)).status).toBe(400);
  });
  test("a section return cannot name another section's item and is atomic", async () => {
    await approveDepartment();
    await submit(department, "R0001");
    const path = `/api/review-stages/${stage("office-planning")}/sections/${department}/return`;
    expect((await call("POST", path, "O0001", {
      message: "수정", itemIds: [item8, seed.departments[1].items.lastWeek[0].id],
    })).status).toBe(403);
    expect((await ok("GET", `/api/items/${item8}`)).status).toBe("승인");
  });
  test("only the assignee may edit, even when the reviewer owns the stage", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await call("POST", `/api/items/${item8}/lock`, "R0001")).status).toBe(403);
  });
  test("a reviewer assigned as a writer retains both scoped roles", async () => {
    await action(item8, "assignment", "R0001");
    await save(item8, "R0001");
    expect((await action(item8, "request-review", "R0001")).actions).toEqual(["withdraw", "approve", "return"]);
  });
  test("out-of-order duplicate approval and withdrawal are rejected", async () => {
    await request();
    await action(item8, "approve", "R0001");
    expect((await call("POST", `/api/items/${item8}/approve`, "R0001")).status).toBe(409);
    expect((await call("POST", `/api/items/${item8}/withdraw`)).status).toBe(409);
  });
});

describe("dashboard visibility, actions and first-screen todos", () => {
  test("members see their department's item states and peers' section states", async () => {
    const view = await dashboard();
    expect(departmentView(view).items).toHaveLength(8);
    expect(departmentView(view, otherDepartment).items).toEqual([]);
    expect(view.departments).toHaveLength(5);
    expect(view.offices).toHaveLength(2);
  });
  test("an office sees items in its scope and state summaries of peer offices", async () => {
    const view = await dashboard("O0001");
    expect(departmentView(view).items).toHaveLength(8);
    expect(departmentView(view, otherDepartment).items).toHaveLength(7);
    expect(departmentView(view, seed.departments[2].id).items).toEqual([]);
    expect((await dashboard("D0001")).departments.every((row) => row.items.length)).toBe(true);
  });
  test("week data redacts peer content while keeping the existing department and category shape", async () => {
    const view = await ok<WeekView>("GET", "/api/week");
    expect(view.departments).toHaveLength(5);
    expect(view.departments[1].items.lastWeek[0]).toMatchObject({
      title: [], content: [], notes: [], tables: [], assignee: "", assignedPeople: [], actions: [],
      review: { version: null, messages: [] },
    });
    expect((await call("GET", `/api/items/${seed.departments[1].items.lastWeek[0].id}`)).status).toBe(403);
  });
  test("a writer's action list contains no reviewer actions", async () => {
    const requested = await request();
    expect(requested.actions).toEqual(["withdraw"]);
    expect((await dashboard()).stages.every((row) => !row.actions.length)).toBe(true);
  });
  test("reviewers receive only the actions valid at their stage", async () => {
    await request();
    expect((await ok("GET", `/api/items/${item8}`, "R0001")).actions).toEqual(["approve", "return"]);
    expect((await ok("GET", `/api/items/${item8}`, "O0001")).actions).toEqual([]);
    expect((await ok("GET", `/api/items/${item8}`, "D0001")).actions).toEqual([]);
  });
  test("a writer's todos contain assigned unwritten, in-progress and returned items", async () => {
    const created = await call("POST", "/api/items", "W1001", { departmentId: department, category: "ongoing" });
    await action(created.data.id, "assignment");
    await action(sibling, "assignment");
    await request();
    await action(item8, "return", "R0001", { message: "수정" });
    const view = await todos();
    const statuses: string[] = view.todos.flatMap((row) => row.kind === "write" ? [row.status] : []);
    expect(statuses.sort())
      .toEqual(["미작성", "수정 요청", "작성 중"].sort());
  });
  test("pending and approved writer items are absent from writing todos", async () => {
    await request();
    expect((await todos()).todos).toEqual([]);
    await action(item8, "approve", "R0001");
    expect((await todos()).todos).toEqual([]);
  });
  test("a department reviewer's todo switches from item review to compilation submission", async () => {
    await request();
    expect((await todos("R0001")).todos).toContainEqual({
      kind: "review-item", itemId: item8, departmentId: department, status: "검토 요청", actions: ["approve", "return"],
    });
    await approveDepartment();
    expect((await todos("R0001")).todos).toEqual([{ kind: "submit", stageId: stage(department), actions: ["submit"] }]);
    await submit(department, "R0001");
    expect((await todos("R0001")).todos).toEqual([]);
  });
  test("an office reviewer's todos contain queued sections then its ready compilation", async () => {
    for (const index of [0, 1]) {
      await approveDepartment(index);
      await submit(seed.departments[index].id, `R000${index + 1}`);
    }
    expect((await todos("O0001")).todos.filter((row) => row.kind === "review-section")).toHaveLength(2);
    for (const id of [department, otherDepartment]) await sectionAction("office-planning", id, "approve", "O0001");
    expect((await todos("O0001")).todos).toEqual([{ kind: "submit", stageId: stage("office-planning"), actions: ["submit"] }]);
  });
  test("the final decider sees queued sections without a further submission action", async () => {
    await approveOffice();
    const view = await todos("D0001");
    expect(view.todos.filter((row) => row.kind === "review-section")).toHaveLength(2);
    expect(view.todos.some((row) => row.kind === "submit")).toBe(false);
  });
  test("other open sessions observe monotonically increasing revisions without sleeps", async () => {
    const before = await dashboard("R0001");
    await request();
    const after = await dashboard("R0001");
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(departmentView(after).items.find((row) => row.id === item8)!.status).toBe("검토 요청");
    expect(after.pollIntervalMs).toBe(1000);
    expect((await dashboard("R0001")).revision).toBe(after.revision);
  });
  test("approved records persist stage, actor, timestamp and fixed section versions", async () => {
    await approveOffice();
    clock += 100;
    await sectionAction("headquarters", department, "approve", "D0001");
    const record = db.query<{ actor: number; at: number; versions: string }, [number]>(`SELECT actor_id AS actor,
      at, versions_json AS versions FROM review_records WHERE stage_id = ? AND action = 'approved'`).get(stage("headquarters"))!;
    expect(record).toMatchObject({ actor: 1, at: clock });
    expect(JSON.parse(record.versions)).toHaveLength(8);
  });
});
