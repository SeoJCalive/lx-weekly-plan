import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import type { ItemView, SaveItemRequest } from "../src/shared/api";
import type { WorkItem } from "../src/shared/weekly-plan";
import { createApp } from "../src/server/app";
import { currentWeekId, databasePath, openDatabase, people, readPlan } from "../src/server/database";
import { createPublishing } from "../src/server/publishing";
import { createReview } from "../src/server/review";
import { demoContent, demoPublicationFix, demoResults, demoReturns, liveReturnMessage } from "./demo-content";

export async function buildDemo(db: Database, templateBytes: Uint8Array): Promise<void> {
  let clock = 0;
  const at = (day: number, hour: number, minute = 0) => {
    clock = Date.UTC(2026, 10, day, hour - 9, minute);
  };
  const now = () => clock;
  const app = createApp({ db, templateBytes, now });
  const accounts = people(db);
  const person = (number: string) => accounts.find(p => p.employeeNumber === number)!;
  const cookies = new Map<string, string>();
  async function call<T = ItemView>(method: string, path: string, account: string, data?: unknown): Promise<T> {
    if (!cookies.has(account)) {
      const response = await app(new Request("http://demo/api/session", {
        method: "POST", body: JSON.stringify(person(account)),
      }));
      if (!response.ok) throw new Error(await response.text());
      cookies.set(account, response.headers.get("set-cookie")!.split(";")[0]);
    }
    const response = await app(new Request(`http://demo/api/${path}`, {
      method, headers: { cookie: cookies.get(account)! },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }));
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  const review = (week: number) => createReview(db, now, week);
  const stages = db.query<{ id: number; organisationId: string; reviewerId: number; parentStageId: number | null },
    []>(`SELECT id, organisation_id AS organisationId, reviewer_id AS reviewerId,
      parent_stage_id AS parentStageId FROM review_stages ORDER BY position`).all();
  const stage = (organisation: string) => stages.find(s => s.organisationId === organisation)!;
  const reviewer = (organisation: string) => accounts.find(p => p.id === stage(organisation).reviewerId)!;
  function writer(id: string) {
    return db.query<{ employeeNumber: string }, [string]>(`SELECT p.employee_number AS employeeNumber
      FROM assignments a JOIN people p ON p.id = a.person_id WHERE a.item_id = ? ORDER BY p.id LIMIT 1`).get(id)!.employeeNumber;
  }
  async function save(item: WorkItem, account: string, input: SaveItemRequest) {
    await call("POST", `items/${item.id}/lock`, account);
    await call("PUT", `items/${item.id}`, account, input);
    await call("DELETE", `items/${item.id}/lock`, account);
  }
  async function amend(week: number, id: string, message: string, note?: string) {
    const item = readPlan(db, week).departments.flatMap(d => Object.values(d.items).flat()).find(i => i.id === id)!;
    const account = writer(id);
    await save(item, account, { ...item, content: [...item.content, [{ text: message }]] });
    review(week).itemAction(id, "request-review", person(account), note ? { note } : {});
  }
  async function writeWeek(week: number, monday: number) {
    at(monday, 9, week === 3 ? 0 : 20);
    for (const content of demoContent.filter(row => row.week === week)) {
      const department = readPlan(db, week).departments.find(d => d.name === content.department)!;
      const item = await call("POST", `items?weekId=${week}`, content.writer, {
        departmentId: department.id, category: "thisWeek",
      });
      await call("POST", `items/${item.id}/assignment`, content.writer);
      await save(item, content.writer, content.item);
    }
    for (const result of demoResults.filter(row => row.week === week)) {
      const department = readPlan(db, week).departments.find(d => d.name === result.department)!;
      const item = department.items.lastWeek.find(i => i.title.map(s => s.text).join("").trim() === result.title)!;
      await save(item, writer(item.id), { ...item, content: result.content });
    }
  }
  async function requestAll(week: number, monday: number) {
    at(monday, week === 3 ? 9 : 15, week === 3 ? 40 : 0);
    for (const department of readPlan(db, week).departments) {
      for (const [position, item] of Object.values(department.items).flat().entries()) {
        if (!db.query("SELECT 1 FROM assignments WHERE item_id = ?").get(item.id)) {
          const candidates = accounts.filter(p => p.role === "writer" && p.departmentId === department.id);
          const original = candidates.find(p => item.assignee.includes(p.name)) ?? candidates[position % candidates.length];
          await call("POST", `items/${item.id}/assignment`, original.employeeNumber);
        }
        review(week).itemAction(item.id, "request-review", person(writer(item.id)), {});
      }
    }
  }
  function approveItems(week: number, except?: string) {
    for (const department of readPlan(db, week).departments) {
      for (const item of Object.values(department.items).flat()) {
        const status = db.query<{ status: string }, [string]>("SELECT status FROM items WHERE id = ?").get(item.id)!.status;
        if (item.id !== except && status === "검토 요청")
          review(week).itemAction(item.id, "approve", reviewer(department.id), {});
      }
    }
  }
  function submitDepartment(week: number, departmentId: string) {
    review(week).submit(stage(departmentId).id, reviewer(departmentId));
  }
  function approveOffices(week: number) {
    const r = review(week);
    for (const office of stages.filter(s => s.parentStageId !== null &&
      !readPlan(db, week).departments.some(d => d.id === s.organisationId))) {
      for (const department of readPlan(db, week).departments.filter(d =>
        stage(d.id).parentStageId === office.id)) {
        const row = r.dashboard(person("D0001")).departments.find(d => d.departmentId === department.id)!;
        if (row.reviews.some(v => v.stageId === office.id && v.status === "검토 요청"))
          r.decideSection(office.id, department.id, "approve", reviewer(office.organisationId), {});
      }
      if (r.dashboard(reviewer(office.organisationId)).stages.find(s => s.id === office.id)!.actions.includes("submit"))
        r.submit(office.id, reviewer(office.organisationId));
    }
    for (const department of r.dashboard(person("D0001")).departments) {
      if (department.reviews.some(v => v.stageId === stage("headquarters").id && v.status === "검토 요청"))
        r.decideSection(stage("headquarters").id, department.departmentId, "approve", person("D0001"), {});
    }
  }
  const publishing = createPublishing(db, templateBytes, now);
  for (const week of [1, 2]) {
    const monday = week === 1 ? 9 : 16;
    if (week === 2) await writeWeek(week, monday);
    await requestAll(week, monday);
    const departments = readPlan(db, week).departments;
    const targetItem = (entry: { department: string; title: string }) => {
      const department = readPlan(db, week).departments.find(d => d.name === entry.department)!;
      return { department, item: department.items.thisWeek.find(i =>
        i.title.map(s => s.text).join("").trim() === entry.title)! };
    };
    const returns = demoReturns.filter(row => row.week === week && row.unit === "item");
    at(monday + 1, 10);
    for (const entry of returns) {
      const { department, item } = targetItem(entry);
      review(week).itemAction(item.id, "return", reviewer(department.id), { message: entry.message });
    }
    at(monday + 2, 10);
    for (const entry of returns) await amend(week, targetItem(entry).item.id, entry.line, entry.note);
    at(monday + 2, 15);
    approveItems(week);
    // First submission determines deadline compliance (Thursday 23:59 KST).
    const late = week === 1 ? [3, 4] : [0, 3];
    at(monday + 3, 10);
    for (const [index, department] of departments.entries())
      if (!late.includes(index)) submitDepartment(week, department.id);
    const sectionReturn = demoReturns.find(row => row.week === week && row.unit === "section")!;
    const { department: target, item: sectionItem } = targetItem(sectionReturn);
    const office = stages.find(s => s.id === stage(target.id).parentStageId)!;
    at(monday + 3, 11);
    review(week).decideSection(office.id, target.id, "return", reviewer(office.organisationId), {
      itemIds: [sectionItem.id], message: sectionReturn.message,
    });
    at(monday + 3, 14);
    await amend(week, sectionItem.id, sectionReturn.line, sectionReturn.note);
    approveItems(week);
    submitDepartment(week, target.id);
    at(monday + 4, 9, 30);
    for (const index of late) submitDepartment(week, departments[index].id);
    at(monday + 4, 10, 30);
    approveOffices(week);
    at(monday + 4, 13);
    publishing.publish(week, person("D0001"));
    if (week === 1) {
      at(13, 14);
      const { item } = targetItem(demoPublicationFix);
      await amend(1, item.id, demoPublicationFix.line, demoPublicationFix.note);
      approveItems(1);
      submitDepartment(1, departments[0].id);
      at(13, 15);
      approveOffices(1);
      at(13, 16);
      publishing.publish(1, person("D0001"));
    }
  }
  await writeWeek(3, 23);
  await requestAll(3, 23);
  const departments = readPlan(db, 3).departments;
  const live = departments[1].items.thisWeek[0];
  at(23, 10);
  approveItems(3, live.id);
  at(23, 10, 30);
  for (const department of departments.filter(d => d.id !== departments[1].id)) submitDepartment(3, department.id);
  at(23, 11);
  approveOffices(3);
  at(23, 11, 20);
  review(3).itemAction(live.id, "return", person("R0002"), { message: liveReturnMessage });
  for (const account of cookies.keys()) await call("DELETE", "session", account);
}

export function demoSummary(db: Database) {
  const now = () => Date.UTC(2026, 10, 23, 2, 20);
  const director = people(db).find(p => p.employeeNumber === "D0001")!;
  return {
    weeks: db.query("SELECT id, metadata_json, is_current FROM weeks ORDER BY id").all(),
    posts: db.query("SELECT week_id, version, title, published_at FROM board_posts ORDER BY id").all(),
    current: createReview(db, now, currentWeekId(db)).dashboard(director).departments.map(d => ({
      name: d.name, status: d.status, counts: d.counts,
      reviews: d.reviews.map(r => ({ stageId: r.stageId, status: r.status })),
    })),
    records: db.query(`SELECT s.week_id, r.action, COUNT(*) AS count FROM review_records r
      JOIN sections s ON s.id = r.section_id GROUP BY s.week_id, r.action ORDER BY s.week_id, r.action`).all(),
  };
}

if (import.meta.main) {
  // Match reset.ts: stop the server before replacing its database files.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(databasePath + suffix, { force: true });
  const db = openDatabase();
  try {
    await buildDemo(db, new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer()));
    console.log(JSON.stringify(demoSummary(db), null, 2));
    console.log(`시연 데이터를 만들었습니다: ${databasePath}`);
  } finally {
    db.close();
  }
}
