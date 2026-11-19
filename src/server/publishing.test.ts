import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { BoardDocument, BoardPost, DashboardView, ItemView, PublishResult, WeekSummary, WeekView } from "../shared/api";
import { seed } from "../shared/seed";
import type { WorkItem } from "../shared/weekly-plan";
import { createApp } from "./app";
import { currentWeekId, openDatabase, readPlan } from "./database";
import { demoAccounts } from "./demo-accounts";
import { generateHwpx } from "./hwpx";
import { paragraphText } from "./template";
import { descendants, parseXml } from "./xml";

const templateBytes = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
let directory: string;
let db: Database;
let handler: ReturnType<typeof createApp>;
let cookies: Map<string, string>;
let clock: number;

async function call(method: string, path: string, account = "D0001", data?: unknown): Promise<Response> {
  if (account && !cookies.has(account)) {
    const person = demoAccounts.find((person) => person.employeeNumber === account)!;
    const response = await handler(new Request("http://localhost/api/session", {
      method: "POST", body: JSON.stringify(person), headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(200);
    cookies.set(account, response.headers.get("set-cookie")!.split(";")[0]);
  }
  return handler(new Request(`http://localhost${path}`, {
    method, headers: { cookie: cookies.get(account) ?? "", "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
}
async function ok<T>(method: string, path: string, account = "D0001", data?: unknown): Promise<T> {
  const response = await call(method, path, account, data);
  const result = await response.json();
  expect({ status: response.status, error: result.error }).toEqual({ status: method === "POST" &&
    path.endsWith("/publish") ? 201 : 200, error: undefined });
  return result as T;
}
const itemAction = (id: string, action: string, account: string) =>
  ok<ItemView>("POST", `/api/items/${id}/${action}`, account);
const dashboard = (weekId = 1) => ok<DashboardView>("GET", `/api/dashboard?weekId=${weekId}`);
const sectionAction = (stageId: number, departmentId: string, account: string, weekId = 1) =>
  ok<DashboardView>("POST", `/api/review-stages/${stageId}/sections/${departmentId}/approve?weekId=${weekId}`, account);
async function approveAll(weekId = 1, final = true): Promise<void> {
  const week = await ok<WeekView>("GET", `/api/week?weekId=${weekId}`);
  const stages = (await dashboard(weekId)).stages;
  for (const [index, department] of week.departments.entries()) {
    const writer = `W${index + 1}001`, reviewer = `R000${index + 1}`;
    for (const item of Object.values(department.items).flat()) {
      await itemAction(item.id, "assignment", writer);
      await itemAction(item.id, "request-review", writer);
      await itemAction(item.id, "approve", reviewer);
    }
    const stage = stages.find((stage) => stage.organisationId === department.id)!;
    await ok("POST", `/api/review-stages/${stage.id}/submit?weekId=${weekId}`, reviewer);
    const parent = stages.find((candidate) => candidate.id === stage.parentStageId)!;
    if (parent.parentStageId !== null) {
      const account = demoAccounts.find((person) => person.organisationId === parent.organisationId)!;
      await sectionAction(parent.id, department.id, account.employeeNumber, weekId);
    }
  }
  for (const stage of stages.filter((stage) => stage.reviewUnit === "section" && stage.parentStageId !== null)) {
    const account = demoAccounts.find((person) => person.organisationId === stage.organisationId)!;
    await ok("POST", `/api/review-stages/${stage.id}/submit?weekId=${weekId}`, account.employeeNumber);
  }
  if (final) {
    const stage = stages.find((stage) => stage.parentStageId === null)!;
    for (const department of week.departments) await sectionAction(stage.id, department.id, "D0001", weekId);
  }
}
const publish = (weekId = 1) => ok<PublishResult>("POST", `/api/weeks/${weekId}/publish`);
const openNext = (weekId = 1) => ok<WeekSummary>("POST", `/api/weeks/${weekId}/open-next`);
async function bytes(path: string, account = "D0001"): Promise<Uint8Array> {
  const response = await call("GET", path, account);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/hwp+zip");
  return new Uint8Array(await response.arrayBuffer());
}
const sectionXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["Contents/section0.xml"]);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lx-publishing-test-"));
  db = openDatabase(join(directory, "test.sqlite"));
  cookies = new Map();
  clock = Date.UTC(2026, 10, 12, 3);
  handler = createApp({ db, templateBytes, now: () => clock });
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("publishing and board versions", () => {
  test("refuses publishing before final approval without creating a post or week", async () => {
    expect((await call("POST", "/api/weeks/1/publish")).status).toBe(409);
    expect(await ok("GET", "/api/board")).toEqual([]);
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(1);
  });
  test("requires final approval of every section, including the direct department", async () => {
    await approveAll(1, false);
    const stage = (await dashboard()).stages.find((stage) => stage.parentStageId === null)!;
    for (const department of seed.departments.slice(0, -1))
      await sectionAction(stage.id, department.id, "D0001");
    expect((await call("POST", "/api/weeks/1/publish")).status).toBe(409);
    await sectionAction(stage.id, seed.departments.at(-1)!.id, "D0001");
    expect((await publish()).post.version).toBe(1);
  });
  test("publishes version 1 with its actor and injected time and opens the next week once", async () => {
    await approveAll();
    const document = readPlan(db, 1);
    const result = await publish();
    expect(result.post).toMatchObject({
      weekId: 1, version: 1, title: "기획혁신본부 주간업무 계획 <11.9.~11.13.> 1차", publishedAt: clock,
      publishedBy: demoAccounts.findIndex((person) => person.employeeNumber === "D0001") + 1,
    });
    expect((await ok<BoardDocument>("GET", `/api/board/${result.post.id}`)).document).toEqual(document);
    expect(result.nextWeek).toMatchObject({ id: 2, isCurrent: true });
    expect(currentWeekId(db)).toBe(2);
    await openNext();
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(2);
  });
  test("keeps version 1 document and download unchanged after editing and re-publishing the earlier week", async () => {
    await approveAll();
    const first = await publish();
    const original = await ok<BoardDocument>("GET", `/api/board/${first.post.id}`);
    const originalBytes = await bytes(`/api/board/${first.post.id}/hwpx`);
    const item = original.document.departments[0].items.ongoing[1];
    await itemAction(item.id, "lock", "W1001");
    const changed = await ok<ItemView>("PUT", `/api/items/${item.id}`, "W1001", {
      ...item, notes: [[{ text: " * 배포 후 보완한 내용" }]],
    });
    expect(changed.status).toBe("작성 중");
    const view = await dashboard();
    expect(view.departments[0].reviews.every((review) => review.status === "작성 중")).toBe(true);
    expect(view.departments.slice(1).every((department) => department.status === "승인")).toBe(true);
    expect((await call("POST", "/api/weeks/1/publish")).status).toBe(409);
    await itemAction(item.id, "request-review", "W1001");
    await itemAction(item.id, "approve", "R0001");
    const departmentStage = view.stages.find((stage) => stage.organisationId === seed.departments[0].id)!;
    const office = view.stages.find((stage) => stage.id === departmentStage.parentStageId)!;
    await ok("POST", `/api/review-stages/${departmentStage.id}/submit?weekId=1`, "R0001");
    await sectionAction(office.id, seed.departments[0].id, "O0001");
    await ok("POST", `/api/review-stages/${office.id}/submit?weekId=1`, "O0001");
    await sectionAction(office.parentStageId!, seed.departments[0].id, "D0001");
    clock += 10_000;
    const second = await publish();
    expect(second.post).toMatchObject({ weekId: 1, version: 2, publishedAt: clock });
    expect(second.post.title).toEndWith(" 2차");
    expect(await ok("GET", `/api/board/${first.post.id}`)).toEqual(original);
    expect(await bytes(`/api/board/${first.post.id}/hwpx`)).toEqual(originalBytes);
    const latest = await ok<BoardDocument>("GET", `/api/board/${second.post.id}`);
    expect(latest.document.departments[0].items.ongoing[1].notes).toEqual(changed.notes);
    const secondBytes = await bytes(`/api/board/${second.post.id}/hwpx`);
    expect(sectionXml(secondBytes)).not.toBe(sectionXml(originalBytes));
    expect(sectionXml(originalBytes)).toBe(sectionXml(generateHwpx(original.document, templateBytes)));
    expect((await ok<BoardPost[]>("GET", "/api/board")).map((post) => post.version)).toEqual([2, 1]);
    expect(currentWeekId(db)).toBe(2);
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(2);
  });
  test("everyone signed in may list posts, view the stored document and download", async () => {
    await approveAll();
    const { post } = await publish();
    for (const account of ["W1001", "W5001", "R0002", "O0002", "D0001"]) {
      expect(await ok<BoardPost[]>("GET", "/api/board", account)).toEqual([post]);
      expect((await ok<BoardDocument>("GET", `/api/board/${post.id}`, account)).document.departments).toHaveLength(5);
      expect((await bytes(`/api/board/${post.id}/hwpx`, account)).length).toBeGreaterThan(0);
    }
  });
  test("unknown week and post IDs return 404 and malformed week selections return 400", async () => {
    for (const path of ["/api/week?weekId=999", "/api/board/999", "/api/board/999/hwpx"])
      expect((await call("GET", path)).status).toBe(404);
    for (const action of ["publish", "open-next"])
      expect((await call("POST", `/api/weeks/999/${action}`)).status).toBe(404);
    for (const id of ["0", "-1", "abc", "1.5", ""])
      expect((await call("GET", `/api/week?weekId=${id}`)).status).toBe(400);
  });
});

describe("week rollover", () => {
  test("copies plans to results and retains ongoing items and their assignments, with new identities and no review state", async () => {
    await approveAll();
    const source = await ok<WeekView>("GET", "/api/week");
    await itemAction(source.departments[0].items.ongoing[0].id, "lock", "W1001");
    await publish();
    const next = await ok<WeekView>("GET", "/api/week");
    expect(next).toMatchObject({
      id: 2, titlePeriod: "<11.　16.　~　11.　20.>", writtenDate: "2026. 11. 16.",
      lastWeekPeriod: "(11. 9. ~ 11. 13.)", thisWeekPeriod: "(11. 16. ~ 11. 20.)",
    });
    const oldIds = new Set(source.departments.flatMap((department) => Object.values(department.items).flat().map((item) => item.id)));
    for (const [index, department] of next.departments.entries()) {
      const previous = source.departments[index];
      expect(department.labels).toEqual(previous.labels);
      expect(department.items.thisWeek).toEqual([]);
      for (const [category, sourceCategory] of [["lastWeek", "thisWeek"], ["ongoing", "ongoing"]] as const) {
        expect(department.items[category]).toHaveLength(previous.items[sourceCategory].length);
        for (const [position, item] of department.items[category].entries()) {
          const original = previous.items[sourceCategory][position];
          const content: WorkItem = { ...readPlan(db, 1).departments[index].items[sourceCategory][position],
            id: item.id, templateItemId: original.id };
          expect(item).toMatchObject({
            ...content, status: "작성 중", assignedPeople: original.assignedPeople, assigneeMode: original.assigneeMode,
            lock: null, review: { version: null, messages: [] }, canEdit: false,
          });
          expect(oldIds.has(item.id)).toBe(false);
        }
      }
    }
    expect((await dashboard(2)).departments.every((department) => department.reviews.length === 0)).toBe(true);
    const paragraphs = descendants(parseXml(sectionXml(await bytes("/api/week/hwpx"))), "hp:p");
    expect(paragraphText(paragraphs.find((p) => p.attributes.id === "26")!)).toBe("2026. 11. 16.");
    expect(paragraphText(paragraphs.find((p) => p.attributes.id === "11")!)).toBe(next.titlePeriod);
    expect(paragraphs.filter((p) => paragraphText(p) === "전주 실적(11. 9. ~ 11. 13.)")).toHaveLength(5);
    expect(paragraphs.filter((p) => paragraphText(p) === "금주 계획(11. 16. ~ 11. 20.)")).toHaveLength(5);
  });
  test("manual opening before publish is idempotent, and publishing does not overwrite that week's edits", async () => {
    const next = await openNext();
    const item = (await ok<WeekView>("GET", "/api/week")).departments[0].items.lastWeek[0];
    await itemAction(item.id, "assignment", "W1001");
    await itemAction(item.id, "lock", "W1001");
    await ok("PUT", `/api/items/${item.id}`, "W1001", { ...item, notes: [[{ text: " * 이월 뒤 작성" }]] });
    const nextDocument = readPlan(db, next.id);
    await approveAll(1);
    expect((await publish()).nextWeek.id).toBe(next.id);
    expect(await openNext()).toMatchObject({ id: next.id });
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(2);
    expect(readPlan(db, next.id)).toEqual(nextDocument);
  });
  test("earlier-week selection scopes creation, labels, dashboard and review without changing the current week", async () => {
    await openNext();
    expect((await ok<WeekView>("GET", "/api/week?weekId=1")).id).toBe(1);
    expect((await dashboard(1)).weekId).toBe(1);
    expect((await ok<{ weekId: number }>("GET", "/api/todos?weekId=1", "W1001")).weekId).toBe(1);
    const response = await call("POST", "/api/items?weekId=1", "W1001", {
      departmentId: seed.departments[0].id, category: "thisWeek",
    });
    expect(response.status).toBe(201);
    const item = await response.json() as ItemView;
    expect(readPlan(db, 1).departments[0].items.thisWeek.at(-1)!.id).toBe(item.id);
    expect(readPlan(db, 2).departments[0].items.thisWeek).toEqual([]);
    await ok("PUT", `/api/departments/${seed.departments[0].id}/label?weekId=1`, "W1001", { thisWeek: " □ 새 소제목" });
    expect(readPlan(db, 1).departments[0].labels.thisWeek).toBe("□ 새 소제목");
    expect(readPlan(db, 2).departments[0].labels.thisWeek).toBe(seed.departments[0].labels.thisWeek);
    expect(currentWeekId(db)).toBe(2);
  });
  test("empty copied items remain 미작성 and copied source typography survives a save and another rollover", async () => {
    const created = await call("POST", "/api/items", "W1001", {
      departmentId: seed.departments[0].id, category: "ongoing",
    });
    expect(created.status).toBe(201);
    await openNext();
    const next = await ok<WeekView>("GET", "/api/week");
    expect(next.departments[0].items.ongoing.at(-1)!.status).toBe("미작성");
    const copied = next.departments[0].items.lastWeek[0];
    await itemAction(copied.id, "assignment", "W1001");
    await itemAction(copied.id, "lock", "W1001");
    const saved = await ok<ItemView>("PUT", `/api/items/${copied.id}`, "W1001", copied);
    expect(saved.templateItemId).toBe(seed.departments[0].items.thisWeek[0].id);
    const ongoing = next.departments[0].items.ongoing[0];
    await openNext(2);
    expect((await ok<WeekView>("GET", "/api/week")).departments[0].items.ongoing[0].templateItemId)
      .toBe(ongoing.templateItemId);
    await openNext(1);
    expect(currentWeekId(db)).toBe(3);
  });
  test("dates cross month and year boundaries using the source week, independent of the publication clock", async () => {
    const { departments: _, ...metadata } = seed;
    db.query("UPDATE weeks SET metadata_json = ? WHERE id = 1").run(JSON.stringify({
      ...metadata, writtenDate: "2026. 12. 28.", thisWeekPeriod: "(12. 28. ~ 1. 1.)",
    }));
    clock = Date.UTC(2030, 4, 1);
    expect(await openNext()).toMatchObject({
      titlePeriod: "<1.　4.　~　1.　8.>", writtenDate: "2027. 1. 4.",
      lastWeekPeriod: "(12. 28. ~ 1. 1.)", thisWeekPeriod: "(1. 4. ~ 1. 8.)",
    });
  });
  test("reopening the database retains published copies and the single rollover link", async () => {
    await approveAll();
    const { post } = await publish();
    const content = await bytes(`/api/board/${post.id}/hwpx`);
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    handler = createApp({ db, templateBytes, now: () => clock });
    expect(await bytes(`/api/board/${post.id}/hwpx`)).toEqual(content);
    expect((await openNext()).id).toBe(2);
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(2);
  });
});

describe("publication authorization", () => {
  test.each(["", "W1001", "R0001", "O0001"])("%s cannot publish or open a week", async (account) => {
    for (const action of ["publish", "open-next"])
      expect((await call("POST", `/api/weeks/1/${action}`, account)).status).toBe(account ? 403 : 401);
    expect(await ok<WeekSummary[]>("GET", "/api/weeks")).toHaveLength(1);
    expect(await ok("GET", "/api/board")).toEqual([]);
  });
  test("the configured final reviewer is required even for an account with the director role", async () => {
    db.query("UPDATE review_stages SET reviewer_id = ? WHERE parent_stage_id IS NULL").run(
      db.query<{ id: number }, []>("SELECT id FROM people WHERE employee_number = 'O0001'").get()!.id,
    );
    for (const action of ["publish", "open-next"])
      expect((await call("POST", `/api/weeks/1/${action}`)).status).toBe(403);
  });
  test("anonymous users cannot read weeks or board documents and downloads", async () => {
    for (const path of ["/api/weeks", "/api/board", "/api/board/1", "/api/board/1/hwpx"])
      expect((await call("GET", path, "")).status).toBe(401);
  });
});
