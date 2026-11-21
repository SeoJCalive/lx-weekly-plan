import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, people, readPlan } from "../src/server/database";
import { createReview } from "../src/server/review";
import { buildDemo, demoSummary } from "./demo";
import { seed } from "../src/shared/seed";
import { plainText } from "../src/shared/weekly-plan";
import { demoContent, demoResults, demoReturns, demoPublicationFix } from "./demo-content";

test("시연 주차·배포 차수·최종 승인·수정 요청과 재생성 결과", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lx-demo-test-"));
  const template = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
  const snapshots = [];
  for (const { department, item } of demoContent) {
    expect(plainText(item.title).length).toBeLessThanOrEqual(16);
    expect(item.content).toHaveLength(1);
    expect(plainText(item.content[0]).startsWith(" ○ (내용) ")).toBe(true);
    expect(item.content[0].at(-1)!.text.length).toBeLessThanOrEqual(18);
    expect(item.notes.length).toBeLessThanOrEqual(department === "예산법무처" ? 0 : 1);
    for (const line of item.notes) {
      expect(plainText(line).startsWith("   * ")).toBe(true);
      expect(plainText(line).slice(5).length).toBeLessThanOrEqual(22);
    }
  }
  for (const result of demoResults) expect(result.line.length).toBeLessThanOrEqual(18);
  for (const entry of demoReturns.filter(row => row.week === 2))
    expect(entry.line.length).toBeLessThanOrEqual(20);
  expect(demoPublicationFix.line).not.toBe(demoReturns[0].line);
  try {
    for (const filename of ["first.sqlite", "second.sqlite"]) {
      const db = openDatabase(join(directory, filename));
      try {
        await buildDemo(db, template);
        expect(db.query("SELECT COUNT(*) AS count FROM weeks").get()).toEqual({ count: 3 });
        expect(readPlan(db, 3).thisWeekPeriod).toBe("(11. 23. ~ 11. 27.)");
        expect(db.query("SELECT week_id, version FROM board_posts ORDER BY id").all()).toEqual([
          { week_id: 1, version: 1 }, { week_id: 1, version: 2 }, { week_id: 2, version: 1 },
        ]);
        const director = people(db).find(p => p.employeeNumber === "D0001")!;
        const board = createReview(db, () => 0, 3).dashboard(director);
        const finalStage = board.stages.find(s => s.parentStageId === null)!;
        expect(board.departments.filter(d => d.reviews.some(r =>
          r.stageId === finalStage.id && r.status === "승인"))).toHaveLength(3);
        const planning = board.departments.find(d => d.name === "기획처")!;
        expect(planning.counts["승인"]).toBe(planning.items.length);
        expect(planning.reviews).toHaveLength(1);
        expect(planning.reviews[0].status).toBe("승인");
        expect(board.stages.find(s => s.id === planning.reviews[0].stageId)!.organisationId).toBe("office-planning");
        expect(board.departments.find(d => d.name === "예산법무처")!.reviews).toHaveLength(0);
        const returned = db.query(`SELECT p.employee_number, o.name FROM items i
          JOIN sections s ON s.id = i.section_id JOIN organisations o ON o.id = s.department_id
          JOIN assignments a ON a.item_id = i.id JOIN people p ON p.id = a.person_id
          WHERE s.week_id = 3 AND i.status = '수정 요청'`).all();
        expect(returned).toEqual([{ employee_number: "W2001", name: "예산법무처" }]);
        const times = db.query<{ first: number; last: number }, []>(`SELECT MIN(r.at) AS first, MAX(r.at) AS last
          FROM review_records r JOIN sections s ON s.id = r.section_id WHERE s.week_id = 3`).get()!;
        expect(times).toEqual({ first: Date.UTC(2026, 10, 20, 5, 40), last: Date.UTC(2026, 10, 20, 7, 20) });
        const plans = [1, 2, 3].map(week => readPlan(db, week));
        const authored = new Map<string, (typeof demoContent)[number]["item"]>();
        for (const [index, plan] of plans.entries()) for (const department of plan.departments)
          demoContent.filter(entry => entry.week === index + 1 && entry.department === department.name)
            .forEach((entry, position) => authored.set(department.items.thisWeek[position].id, entry.item));
        // Authored content: the 8-character " ○ (내용) " prefix plus at most 20 characters.
        // Rollovers retain their earliest origin in templateItemId.
        for (const plan of plans) for (const department of plan.departments)
          for (const item of Object.values(department.items).flat()) {
            const originId = item.templateItemId ?? item.id;
            const seedItem = seed.departments.flatMap(d => Object.values(d.items).flat()).find(i => i.id === originId);
            const original = seedItem ?? authored.get(originId)!;
            expect(original).toBeDefined();
            for (const key of ["content", "notes"] as const) {
              expect(item[key]).toHaveLength(original[key].length);
              if (key === "notes" && !seedItem) expect(item.notes).toEqual(original.notes);
              else item[key].forEach((line, i) =>
                expect(plainText(line).length).toBeLessThanOrEqual(seedItem ? plainText(original[key][i]).length : 28));
            }
            expect(item.content[0]?.slice(0, -1)).toEqual(original.content[0]?.slice(0, -1));
          }
        const counts = Object.fromEntries(["weeks", "items", "assignments", "item_versions", "review_records",
          "review_sections", "board_posts", "week_rollovers", "sessions", "edit_locks"].map(table =>
          [table, db.query(`SELECT COUNT(*) AS count FROM ${table}`).get()]));
        // Item UUIDs are generated by the normal write/rollover routes.
        const ids = new Map<string, string>();
        for (const plan of plans) for (const department of plan.departments)
          for (const item of Object.values(department.items).flat())
            for (const key of ["id", "templateItemId"] as const) {
              const id = item[key];
              if (!id || id.startsWith("item-")) continue;
              if (!ids.has(id)) ids.set(id, `generated-${ids.size}`);
              item[key] = ids.get(id)!;
            }
        snapshots.push({ counts, summary: demoSummary(db), plans });
      } finally {
        db.close();
      }
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
