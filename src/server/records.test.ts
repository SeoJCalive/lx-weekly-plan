import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { DeadlineView, ItemHistory, ItemView, SaveItemRequest, StatisticsView, WeekSummary } from "../shared/api";
import { seed } from "../shared/seed";
import { createApp } from "./app";
import { openDatabase } from "./database";
import { demoAccounts } from "./demo-accounts";
import { generateHwpx } from "./hwpx";
import { paragraphText, readTemplate } from "./template";
import { descendants, parseXml, serialize } from "./xml";

const templateBytes = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const department = seed.departments[0], budget = seed.departments[1], digital = seed.departments.slice(2, 4);
const item = department.items.ongoing[1];
const input: SaveItemRequest = {
  title: [{ text: "검토 업무" }], content: [[{ text: " ○ 본문" }]], notes: [[{ text: " * 근거" }]],
  tables: [], assignee: "담당자",
};
let directory: string;
let db: Database;
let handler: ReturnType<typeof createApp>;
let clock: number;
let cookies: Map<string, string>;

async function response(method: string, path: string, account = "W1001", data?: unknown): Promise<Response> {
  if (account && !cookies.has(account)) {
    const demo = demoAccounts.find((person) => person.employeeNumber === account)!;
    const signedIn = await handler(new Request("http://localhost/api/session", {
      method: "POST", body: JSON.stringify(demo), headers: { "Content-Type": "application/json" },
    }));
    expect(signedIn.status).toBe(200);
    cookies.set(account, signedIn.headers.get("set-cookie")!.split(";")[0]);
  }
  return handler(new Request(`http://localhost${path}`, {
    method, headers: { cookie: cookies.get(account) ?? "", "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
}
async function ok<T = ItemView>(method: string, path: string, account = "W1001", data?: unknown): Promise<T> {
  const result = await response(method, path, account, data);
  expect(result.status).toBe(200);
  return result.json() as Promise<T>;
}
const action = (name: string, account = "W1001", data?: unknown, id = item.id) =>
  ok("POST", `/api/items/${id}/${name}`, account, data);
const history = (account = "W1001") => ok<ItemHistory>("GET", `/api/items/${item.id}/history`, account);
const deadline = (account = "W1001", query = "") => ok<DeadlineView>("GET", `/api/deadline${query}`, account);
const setDeadline = (deadlineAt: number) => ok<DeadlineView>("PUT", "/api/deadline", "D0001", { deadlineAt });
const statistics = () => ok<StatisticsView>("GET", "/api/statistics");
const stage = (id: string) => db.query<{ id: number }, [string]>(
  "SELECT id FROM review_stages WHERE organisation_id = ?",
).get(id)!.id;
async function save(data = input): Promise<ItemView> {
  await action("lock");
  return ok("PUT", `/api/items/${item.id}`, "W1001", data);
}
async function compile(index = 0): Promise<void> {
  const source = seed.departments[index], writer = `W${index + 1}001`, reviewer = `R000${index + 1}`;
  for (const row of Object.values(source.items).flat()) {
    const current = await ok("GET", `/api/items/${row.id}`, writer);
    if (current.status === "승인") continue;
    if (current.status !== "검토 요청") {
      await action("assignment", writer, undefined, row.id);
      await action("request-review", writer, undefined, row.id);
    }
    await action("approve", reviewer, undefined, row.id);
  }
  await ok("POST", `/api/review-stages/${stage(source.id)}/submit`, reviewer);
}
async function exported(organisationId: string, account: string) {
  const result = await response("GET", `/api/week/hwpx?organisationId=${organisationId}`, account);
  expect(result.status).toBe(200);
  expect(result.headers.get("Content-Type")).toBe("application/hwp+zip");
  return readTemplate(new Uint8Array(await result.arrayBuffer()));
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lx-records-test-"));
  db = openDatabase(join(directory, "test.sqlite"));
  clock = Date.parse("2026-11-12T12:00:00+09:00");
  cookies = new Map();
  handler = createApp({ db, templateBytes, now: () => clock });
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("item history from fixed review records", () => {
  test("interim saves and withdrawal never appear; only the three recorded kinds do", async () => {
    await action("assignment");
    await save();
    await save({ ...input, notes: [[{ text: " * 중간 저장" }]] });
    expect((await history()).entries).toEqual([]);
    await action("request-review", "W1001", { note: "첫 제출 무시" });
    await action("withdraw");
    await save();
    await action("request-review", "W1001", { note: "회수 후 다시 확인" });
    clock += 1;
    await action("return", "R0001", { message: "근거를 보완하세요." });
    await save({ ...input, notes: [[{ text: " * 보완 근거" }]] });
    clock += 1;
    await action("request-review", "W1001", { note: "  근거 보완  " });
    await action("approve", "R0001");
    const result = await history();
    expect(result.entries.map((entry) => entry.action))
      .toEqual(["requested", "requested", "returned", "requested", "approved"]);
    expect(result.entries.map((entry) => entry.versionNumber)).toEqual([1, 2, 2, 3, 3]);
    expect(result.entries.map((entry) => entry.note)).toEqual([null, "회수 후 다시 확인", "회수 후 다시 확인", "근거 보완", "근거 보완"]);
    expect(result.entries[2]).toMatchObject({
      at: clock - 1, actor: { employeeNumber: "R0001" }, message: "근거를 보완하세요.",
      content: { notes: input.notes },
    });
    expect(result.entries.at(-1)!.content.notes).toEqual([[{ text: " * 보완 근거" }]]);
    expect(result.entries.every((entry) => entry.content.id === item.id)).toBe(true);
    expect(result.entries.map((entry) => entry.at)).toEqual([...result.entries.map((entry) => entry.at)].sort());
  });
  test("differences include old and new title, content lines, notes, tables and assignee", async () => {
    await action("assignment");
    await save();
    await action("request-review");
    await action("return", "R0001", { message: "수정" });
    const updated: SaveItemRequest = {
      title: [{ text: "변경 제목", color: "blue", bold: true }],
      content: [[{ text: " ○ 첫째" }], [{ text: " ○ 둘째" }]],
      notes: [], tables: structuredClone(budget.items.ongoing[2].tables), assignee: "새 담당",
    };
    await save(updated);
    await action("request-review");
    await action("approve", "R0001");
    const entries = (await history()).entries;
    expect(entries[0].changes).toEqual([]);
    expect(entries[1].changes).toEqual([]);
    expect(entries[2].changes.map((change) => change.field)).toEqual(["title", "content", "notes", "tables", "assignee"]);
    for (const change of entries[2].changes) {
      expect(change.oldValue).toEqual<unknown>(input[change.field]);
      expect(change.newValue).toEqual<unknown>(updated[change.field]);
    }
    expect(entries[3].changes).toEqual([]);
    await save(input);
    expect((await history()).entries).toEqual(entries);
  });
  test("section approvals include each fixed item; section returns include only the selected items", async () => {
    await compile();
    const path = `/api/review-stages/${stage("office-planning")}/sections/${department.id}`;
    await ok("POST", `${path}/approve`, "O0001");
    expect((await history()).entries.map((entry) => entry.action)).toEqual(["requested", "approved", "approved"]);
    expect((await history()).entries.at(-1)!.actor.employeeNumber).toBe("O0001");
    const other = department.items.lastWeek[0].id;
    await ok("POST", `${path}/return`, "O0001", { itemIds: [other], message: "지목 항목만 수정" });
    expect((await history()).entries).toHaveLength(3);
    const returned = await ok<ItemHistory>("GET", `/api/items/${other}/history`);
    expect(returned.entries.at(-1)).toMatchObject({
      action: "returned", message: "지목 항목만 수정", actor: { employeeNumber: "O0001" },
    });
  });
  test("history follows content scope and requires sign-in", async () => {
    await action("assignment");
    await action("request-review");
    for (const account of ["W1001", "R0001", "O0001", "D0001"]) expect((await history(account)).entries).toHaveLength(1);
    for (const account of ["W2001", "O0002", ""]) {
      expect((await response("GET", `/api/items/${item.id}/history`, account)).status).toBe(account ? 403 : 401);
    }
    expect((await response("GET", "/api/items/missing/history")).status).toBe(404);
  });
});

describe("deadline and department statistics", () => {
  test("the default is this week's Thursday end in Korea, with an injected clock boundary", async () => {
    const due = Date.parse("2026-11-12T23:59:59.999+09:00");
    expect(await deadline()).toEqual({ weekId: 1, deadlineAt: due, passed: false, canChange: false });
    clock = due;
    expect((await deadline()).passed).toBe(false);
    clock++;
    expect((await deadline()).passed).toBe(true);
    expect((await deadline("D0001")).canChange).toBe(true);
  });
  test("only the final stage's registered director can change a persisted deadline", async () => {
    const due = clock + 3600;
    for (const account of ["W1001", "R0001", "O0001", ""]) {
      expect((await response("PUT", "/api/deadline", account, { deadlineAt: due })).status).toBe(account ? 403 : 401);
    }
    await setDeadline(due);
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    handler = createApp({ db, templateBytes, now: () => clock });
    expect((await deadline()).deadlineAt).toBe(due);
    db.query("UPDATE review_stages SET reviewer_id = ? WHERE parent_stage_id IS NULL").run(
      db.query<{ id: number }, []>("SELECT id FROM people WHERE employee_number = 'O0001'").get()!.id,
    );
    expect((await response("PUT", "/api/deadline", "D0001", { deadlineAt: due })).status).toBe(403);
  });
  test("invalid deadlines, missing weeks and invalid week IDs are rejected", async () => {
    for (const deadlineAt of [null, "2026-11-12", 1.5, 9e15]) {
      expect((await response("PUT", "/api/deadline", "D0001", { deadlineAt })).status).toBe(400);
    }
    expect((await response("GET", "/api/deadline?weekId=999")).status).toBe(404);
    expect((await response("GET", "/api/statistics?weekId=bad")).status).toBe(400);
    expect((await response("GET", "/api/deadline", "")).status).toBe(401);
  });
  test("upgrading an earlier database adds the override without changing the plan", async () => {
    db.exec("ALTER TABLE weeks DROP COLUMN deadline_at");
    db.close();
    db = openDatabase(join(directory, "test.sqlite"));
    handler = createApp({ db, templateBytes, now: () => clock });
    expect((await deadline()).deadlineAt).toBe(Date.parse("2026-11-12T23:59:59.999+09:00"));
  });
  test("each new week gets its own default instead of inheriting the override", async () => {
    await setDeadline(clock);
    const next = await ok<WeekSummary>("POST", "/api/weeks/1/open-next", "D0001");
    expect((await deadline()).deadlineAt).toBe(Date.parse("2026-11-19T23:59:59.999+09:00"));
    expect((await deadline("W1001", "?weekId=1")).deadlineAt).toBe(clock);
    expect((await deadline()).weekId).toBe(next.id);
  });
  test("passing the deadline blocks neither new writing, review, approval nor compilation", async () => {
    await setDeadline(clock - 1);
    expect((await deadline()).passed).toBe(true);
    const created = await response("POST", "/api/items", "W1001", { departmentId: department.id, category: "thisWeek" });
    expect(created.status).toBe(201);
    const added = await created.json() as ItemView;
    await action("assignment", "W1001", undefined, added.id);
    await action("lock", "W1001", undefined, added.id);
    await ok("PUT", `/api/items/${added.id}`, "W1001", input);
    await action("request-review", "W1001", undefined, added.id);
    await action("approve", "R0001", undefined, added.id);
    await action("assignment");
    await save();
    await action("request-review");
    await action("return", "R0001", { message: "기한 뒤 수정" });
    await save({ ...input, notes: [] });
    await action("request-review");
    await compile();
    expect((await statistics()).departments[0]).toMatchObject({
      revisions: 1, revisionRequests: 1, firstSubmittedAt: clock, deadlineMet: false,
    });
  });
  test("statistics count re-submissions and item revision requests, and use the first department compilation", async () => {
    await setDeadline(clock + 100);
    await action("assignment");
    await save();
    await action("request-review");
    await action("return", "R0001", { message: "첫 수정" });
    await save({ ...input, notes: [] });
    await action("request-review");
    await action("approve", "R0001");
    const pending = (await statistics()).departments[0];
    expect(pending).toMatchObject({ revisions: 1, revisionRequests: 1, firstSubmittedAt: null, deadlineMet: null });
    clock += 100;
    await compile();
    const first = clock;
    expect((await statistics()).departments[0].deadlineMet).toBe(true);
    const path = `/api/review-stages/${stage("office-planning")}/sections/${department.id}`;
    await ok("POST", `${path}/return`, "O0001", { itemIds: [item.id], message: "상급 수정" });
    clock++;
    await action("request-review");
    await compile();
    const view = await statistics();
    expect(view.departments[0]).toMatchObject({
      departmentId: department.id, revisions: 2, revisionRequests: 2, firstSubmittedAt: first, deadlineMet: true,
    });
    expect(view.departments.slice(1).every((row) => row.revisions === 0 && row.revisionRequests === 0 &&
      row.firstSubmittedAt === null && row.deadlineMet === false)).toBe(true);
    expect(view.departments.map((row) => row.departmentId)).toEqual(seed.departments.map((row) => row.id));
    expect((await ok<StatisticsView>("GET", "/api/statistics", "W5001")).departments).toEqual(view.departments);
    expect((await response("GET", "/api/statistics", "")).status).toBe(401);
  });
  test("section revision requests count targeted items, while statistics stay within the selected week", async () => {
    await compile();
    await ok("POST", `/api/review-stages/${stage("office-planning")}/sections/${department.id}/return`, "O0001", {
      itemIds: [item.id, department.items.lastWeek[0].id], message: "두 항목 수정",
    });
    expect((await statistics()).departments[0].revisionRequests).toBe(2);
    await ok("POST", "/api/weeks/1/open-next", "D0001");
    expect((await statistics()).departments.every((row) => row.revisions === 0 && row.revisionRequests === 0 &&
      row.firstSubmittedAt === null)).toBe(true);
    expect((await ok<StatisticsView>("GET", "/api/statistics?weekId=1")).departments[0].revisionRequests).toBe(2);
  });
});

describe("scoped partial hwpx", () => {
  test("the own-department document retains the cover, logos, section tables, nested tables, merges and SUM", async () => {
    const result = await exported(budget.id, "W2001");
    const baseline = readTemplate(generateHwpx(seed, templateBytes));
    expect(result.departments.map((row) => row.data.id)).toEqual([budget.id]);
    expect(result.cover.map(serialize)).toEqual(baseline.cover.map(serialize));
    expect(serialize(result.departments[0].main)).toBe(serialize(baseline.departments[1].main));
    expect(serialize(result.departments[0].ongoing)).toBe(serialize(baseline.departments[1].ongoing));
    expect(result.departments[0].nodes[0].attributes.pageBreak).toBe("1");
    expect(descendants(result.departments[0].nodes.at(-1)!, "hp:tbl")).toHaveLength(2);
    expect(descendants(result.section, "hp:fieldBegin").some((field) => field.attributes.type === "FORMULA")).toBe(true);
    expect(descendants(result.section, "hp:cellSpan").some((span) => Number(span.attributes.colSpan) > 1)).toBe(true);
    for (const [name, bytes] of Object.entries(baseline.entries)) {
      if (name.startsWith("BinData/")) expect(result.entries[name]).toEqual(bytes);
    }
    expect(result.data.title).toBe(seed.title);
  });
  test("the office document includes exactly its two sections in organisation order", async () => {
    const result = await exported("office-digital", "O0002");
    const baseline = readTemplate(generateHwpx(seed, templateBytes));
    expect(result.departments.map((row) => row.data.id)).toEqual(digital.map((row) => row.id));
    expect(result.departments.map((row) => [serialize(row.main), serialize(row.ongoing)]))
      .toEqual(baseline.departments.slice(2, 4).map((row) => [serialize(row.main), serialize(row.ongoing)]));
    expect(result.departments.every((row) => row.nodes[0].attributes.pageBreak === "1")).toBe(true);
    expect(result.cover.map(serialize)).toEqual(baseline.cover.map(serialize));
    expect(result.departments.map((row) => paragraphText(row.nodes[0])))
      .toEqual(digital.map((row) => `[${row.parentOffice}_${row.name}]`));
  });
  test("department heads, office heads and the director can export their permitted departments", async () => {
    for (const account of ["R0002", "O0001", "D0001"]) {
      expect((await exported(budget.id, account)).departments.map((row) => row.data.id)).toEqual([budget.id]);
    }
    expect((await exported("office-digital", "D0001")).departments).toHaveLength(2);
    expect((await exported(seed.departments[4].id, "W5001")).departments).toHaveLength(1);
  });
  test("writers and department heads cannot export upward to their office or outside their department", async () => {
    for (const account of ["W1001", "R0001"]) {
      for (const id of ["office-planning", budget.id, "office-digital"]) {
        expect((await response("GET", `/api/week/hwpx?organisationId=${id}`, account)).status).toBe(403);
      }
    }
    for (const id of ["office-digital", digital[0].id, seed.departments[4].id]) {
      expect((await response("GET", `/api/week/hwpx?organisationId=${id}`, "O0001")).status).toBe(403);
    }
    expect((await response("GET", `/api/week/hwpx?organisationId=${department.id}`, "")).status).toBe(401);
    expect((await response("GET", "/api/week/hwpx?organisationId=missing")).status).toBe(404);
    expect((await response("GET", "/api/week/hwpx?organisationId=headquarters", "D0001")).status).toBe(400);
  });
  test("the whole-week export retains every original archive entry byte for the same input", async () => {
    const result = await response("GET", "/api/week/hwpx", "D0001");
    expect(result.status).toBe(200);
    expect(unzipSync(new Uint8Array(await result.arrayBuffer()))).toEqual(unzipSync(generateHwpx(seed, templateBytes)));
  });
  test("partial exports honor the selected week", async () => {
    await ok("POST", "/api/weeks/1/open-next", "D0001");
    const current = await response("GET", "/api/week/hwpx?organisationId=office-digital", "O0002");
    expect(current.status).toBe(200);
    const entries = unzipSync(new Uint8Array(await current.arrayBuffer()));
    const paragraphs = descendants(parseXml(strFromU8(entries["Contents/section0.xml"])), "hp:p");
    expect(paragraphText(paragraphs.find((p) => p.attributes.id === "26")!)).toBe("2026. 11. 16.");
    const previous = await response("GET", "/api/week/hwpx?weekId=1&organisationId=office-digital", "O0002");
    expect(readTemplate(new Uint8Array(await previous.arrayBuffer())).data.writtenDate).toBe(seed.writtenDate);
  });
});
