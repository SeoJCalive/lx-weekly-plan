import { mkdir } from "node:fs/promises";
import { seed } from "../src/shared/seed";
import { generateHwpx } from "../src/server/hwpx";
import type { TableCell, WeeklyPlan, WorkTable } from "../src/shared/weekly-plan";

export function changedCases(): WeeklyPlan[] {
  const cases = Array.from({ length: 4 }, () => structuredClone(seed));
  const edited = cases[0].departments[0].items.lastWeek[0];
  edited.title = [{ text: "수정된 업무 제목", bold: true }];
  edited.content = [[{ text: " ○ (내용) 수정한 본문을 확인합니다." }]];

  const department = cases[1].departments[0];
  department.items.lastWeek.push({
    id: "added-item",
    title: [{ text: "추가한 네 번째 업무", bold: true }],
    content: [[{ text: " ○ (내용) 추가 항목의 본문입니다." }]],
    notes: [[{ text: "   * 새 항목의 부가 설명" }]],
    tables: [],
    assignee: "나현수 담당자",
  });
  department.items.thisWeek.splice(1, 1);

  const cell = (row: number, column: number, text: string, colSpan = 1): TableCell => ({
    row, column, rowSpan: 1, colSpan, alignment: "center",
    paragraphs: [[{ text, bold: row === 0 }]],
  });
  const table: WorkTable = {
    id: "changed-litigation-table",
    rows: 4, columns: 5,
    columnWidths: [10000, 10000, 10000, 10000, 9509],
    rowHeights: [1600, 1600, 1600, 1600],
    caption: [[{ text: "[단위: 건] ", bold: false }]],
    cells: [
      cell(0, 0, "변경 현황", 2), cell(0, 2, "다"), cell(0, 3, "라"), cell(0, 4, "합계"),
      ...[10, 20, 30, 40, ""].map((v, c) => cell(1, c, String(v))),
      ...[1, 2, 3, 4, ""].map((v, c) => cell(2, c, String(v))),
      cell(3, 0, "전체 합계", 4),
      { ...cell(3, 4, ""), formula: { type: "SUM", from: { row: 1, column: 0 }, to: { row: 2, column: 3 } } },
    ],
  };
  cases[2].departments[1].items.ongoing[2].tables = [table];
  cases[3].departments[0].items.lastWeek[0].content = [[
    { text: " ○ (내용) " }, { text: "굵은 글자", bold: true },
    { text: " 파란 글자", color: "blue" }, { text: " 빨간 글자", color: "red", bold: true },
  ]];
  return cases;
}

if (import.meta.main) {
  const template = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
  await mkdir("out", { recursive: true });
  for (const [index, data] of changedCases().entries()) {
    const path = `out/case-${index + 1}.hwpx`;
    await Bun.write(path, generateHwpx(data, template));
    console.log(path);
  }
}
