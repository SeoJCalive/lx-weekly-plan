import { mkdir } from "node:fs/promises";
import type { BoardDocument, BoardPost, DashboardView, ItemView, Person, PublishResult, WeekSummary, WeekView } from "../src/shared/api";

// Run against a fresh, dedicated database, with the server already listening.
const base = process.env.API_URL ?? "http://127.0.0.1:4310";
const cookies = new Map<string, string>();
async function request<T>(method: string, path: string, account = "", body?: unknown): Promise<T> {
  const args = ["curl", "-i", "--fail-with-body", "--silent", "--show-error", "-X", method, `${base}${path}`];
  if (account) args.push("-H", `Cookie: ${cookies.get(account)}`);
  if (body !== undefined) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  const process = Bun.spawn(args, { env: globalThis.process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [output, error, exit] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (exit !== 0) throw new Error(`${method} ${path}: ${error}\n${output}`);
  const boundary = output.indexOf("\r\n\r\n"), headers = output.slice(0, boundary);
  const result = JSON.parse(output.slice(boundary + 4));
  const token = /set-cookie:\s*([^;\r\n]+)/i.exec(headers)?.[1];
  if (token && body) cookies.set((body as Person).employeeNumber, token);
  const departments = result.departments as DashboardView["departments"] | undefined;
  const state = result.status ?? (departments?.[0]?.departmentId ?
    departments.map((department) => `${department.departmentId}=${department.status}`).join(", ") : "");
  console.log(`${method} ${path} -> ${headers.split("\r\n")[0]}${state ? ` | ${state}` : ""}`);
  return result as T;
}
const accounts = await request<Person[]>("GET", "/api/accounts");
for (const employeeNumber of ["W1001", "R0001", "W2001", "R0002", "O0001", "D0001"]) {
  const account = accounts.find((account) => account.employeeNumber === employeeNumber)!;
  await request("POST", "/api/session", "", { name: account.name, employeeNumber });
}
const week = await request<WeekView>("GET", "/api/week", "D0001");
const [first, second] = week.departments;
const item8 = Object.values(first.items).flat()[7];
console.log(`Eighth source item: ${item8.id}`);
const stages = (await request<DashboardView>("GET", "/api/dashboard", "D0001")).stages;
const departmentStage = stages.find((stage) => stage.organisationId === first.id)!;
const officeStage = stages.find((stage) => stage.id === departmentStage.parentStageId)!;
const finalStage = stages.find((stage) => stage.id === officeStage.parentStageId)!;
const itemAction = (id: string, action: string, account: string, body?: unknown) =>
  request<ItemView>("POST", `/api/items/${id}/${action}`, account, body);
const edit = async (notes: string) => {
  await itemAction(item8.id, "lock", "W1001");
  await request<ItemView>("PUT", `/api/items/${item8.id}`, "W1001", {
    title: item8.title, content: item8.content, notes: [[{ text: notes }]], tables: item8.tables,
  });
};
await itemAction(item8.id, "assignment", "W1001");
await edit(" * 검증 작성");
await itemAction(item8.id, "request-review", "W1001");
await itemAction(item8.id, "return", "R0001", { message: "검토 근거를 보완하세요." });
await edit(" * 검증 검토 근거 보완");
const resubmitted = await itemAction(item8.id, "request-review", "W1001");
if (resubmitted.review.version?.number !== 2) throw new Error("Expected the second fixed review version.");
await itemAction(item8.id, "approve", "R0001");
for (const [index, department] of [first, second].entries()) {
  const writer = `W${index + 1}001`, reviewer = `R000${index + 1}`;
  for (const item of Object.values(department.items).flat()) {
    if (item.id === item8.id) continue;
    await itemAction(item.id, "assignment", writer);
    await itemAction(item.id, "request-review", writer);
    await itemAction(item.id, "approve", reviewer);
  }
  const stage = stages.find((stage) => stage.organisationId === department.id)!;
  await request("POST", `/api/review-stages/${stage.id}/submit`, reviewer);
  await request("POST", `/api/review-stages/${officeStage.id}/sections/${department.id}/approve`, "O0001");
}
await request("POST", `/api/review-stages/${officeStage.id}/submit`, "O0001");
const final = await request<DashboardView>("POST",
  `/api/review-stages/${finalStage.id}/sections/${first.id}/approve`, "D0001");
const finalDepartment = final.departments.find((department) => department.departmentId === first.id)!;
if (finalDepartment.status !== "승인" || finalDepartment.reviews.some((review) => review.status !== "승인"))
  throw new Error("Expected approval at every stage.");
console.log(`VERIFIED ${item8.id}: 작성 중 -> 검토 요청 -> 수정 요청 -> 작성 중 -> 검토 요청 -> 승인 -> 처 상신 -> 실 승인 -> 실 상신 -> 본부 승인`);

if (process.argv.includes("--publish")) {
  for (const account of accounts) if (!cookies.has(account.employeeNumber))
    await request("POST", "/api/session", "", { name: account.name, employeeNumber: account.employeeNumber });
  const selected = `?weekId=${week.id}`;
  const snapshot = (account = "D0001") => request<DashboardView>("GET", `/api/dashboard${selected}`, account);
  for (const [index, department] of week.departments.entries()) {
    const writer = `W${index + 1}001`, reviewer = `R000${index + 1}`;
    for (const item of Object.values(department.items).flat()) {
      const current = await request<ItemView>("GET", `/api/items/${item.id}`, writer);
      if (current.status === "승인") continue;
      await itemAction(item.id, "assignment", writer);
      await itemAction(item.id, "request-review", writer);
      await itemAction(item.id, "approve", reviewer);
    }
    let view = await snapshot(reviewer);
    const stage = view.stages.find((stage) => stage.organisationId === department.id)!;
    if (stage.actions.includes("submit"))
      view = await request("POST", `/api/review-stages/${stage.id}/submit${selected}`, reviewer);
    const parent = view.stages.find((candidate) => candidate.id === stage.parentStageId)!;
    if (parent.parentStageId !== null) {
      const account = accounts.find((account) => account.id === parent.reviewerId)!;
      view = await snapshot(account.employeeNumber);
      const review = view.departments.find((row) => row.departmentId === department.id)!.reviews
        .find((review) => review.stageId === parent.id)!;
      if (review.actions.includes("approve"))
        await request("POST", `/api/review-stages/${parent.id}/sections/${department.id}/approve${selected}`, account.employeeNumber);
    }
  }
  for (const stage of (await snapshot()).stages.filter((stage) =>
    stage.reviewUnit === "section" && stage.parentStageId !== null)) {
    const account = accounts.find((account) => account.id === stage.reviewerId)!;
    const ownStage = (await snapshot(account.employeeNumber)).stages.find((candidate) => candidate.id === stage.id)!;
    if (ownStage.actions.includes("submit"))
      await request("POST", `/api/review-stages/${stage.id}/submit${selected}`, account.employeeNumber);
  }
  for (const department of (await snapshot()).departments) {
    if (department.reviews.find((review) => review.stageId === finalStage.id)?.actions.includes("approve"))
      await request("POST", `/api/review-stages/${finalStage.id}/sections/${department.departmentId}/approve${selected}`, "D0001");
  }
  const firstPublish = await request<PublishResult>("POST", `/api/weeks/${week.id}/publish`, "D0001");
  if (firstPublish.post.version !== 1 || firstPublish.nextWeek.id === week.id)
    throw new Error("Expected first publication and a new current week.");
  const firstPost = await request<BoardDocument>("GET", `/api/board/${firstPublish.post.id}`, "W5001");
  await request<BoardPost[]>("GET", "/api/board", "W5001");
  await mkdir("out", { recursive: true });
  async function download(path: string, output?: string): Promise<Uint8Array> {
    const process = Bun.spawn(["curl", "--fail-with-body", "--silent", "--show-error",
      "-H", `Cookie: ${cookies.get("W5001")}`, `${base}${path}`], {
      env: globalThis.process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [buffer, error, exit] = await Promise.all([
      new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited,
    ]);
    if (exit !== 0) throw new Error(`Download ${path}: ${error}`);
    const bytes = new Uint8Array(buffer);
    if (output) await Bun.write(output, bytes);
    console.log(`GET ${path} -> ${bytes.length} bytes${output ? ` | ${output}` : ""}`);
    return bytes;
  }
  const firstBytes = await download(`/api/board/${firstPublish.post.id}/hwpx`, "out/u4-v1.hwpx");
  await edit(" * 배포 후 보완한 검토 근거");
  const view = await snapshot();
  if (view.departments[0].status !== "작성 중" || view.departments.slice(1).some((row) => row.status !== "승인"))
    throw new Error("An edit must release approvals only in the affected department.");
  await itemAction(item8.id, "request-review", "W1001");
  await itemAction(item8.id, "approve", "R0001");
  await request("POST", `/api/review-stages/${departmentStage.id}/submit${selected}`, "R0001");
  await request("POST", `/api/review-stages/${officeStage.id}/sections/${first.id}/approve${selected}`, "O0001");
  await request("POST", `/api/review-stages/${officeStage.id}/submit${selected}`, "O0001");
  await request("POST", `/api/review-stages/${finalStage.id}/sections/${first.id}/approve${selected}`, "D0001");
  const secondPublish = await request<PublishResult>("POST", `/api/weeks/${week.id}/publish`, "D0001");
  if (secondPublish.post.version !== 2 || secondPublish.nextWeek.id !== firstPublish.nextWeek.id)
    throw new Error("Expected version 2 and the same next week.");
  await download(`/api/board/${secondPublish.post.id}/hwpx`, "out/u4-v2.hwpx");
  const repeated = await download(`/api/board/${firstPublish.post.id}/hwpx`);
  if (!Bun.deepEquals(firstBytes, repeated)) throw new Error("Version 1 download changed after editing.");
  const retained = await request<BoardDocument>("GET", `/api/board/${firstPublish.post.id}`, "W5001");
  if (!Bun.deepEquals(firstPost, retained)) throw new Error("Version 1 stored document changed after editing.");
  const posts = await request<BoardPost[]>("GET", "/api/board", "W5001");
  if (posts.length !== 2 || posts[0].version !== 2 || posts[1].version !== 1)
    throw new Error("Expected two ordered publication versions.");
  const weeks = await request<WeekSummary[]>("GET", "/api/weeks", "D0001");
  if (weeks.length !== 2 || !weeks.find((row) => row.id === firstPublish.nextWeek.id)?.isCurrent)
    throw new Error("Expected exactly one new current week.");
  const next = await request<WeekView>("GET", "/api/week", "D0001");
  for (const [index, department] of next.departments.entries()) {
    const previous = firstPost.document.departments[index];
    for (const [category, source] of [["lastWeek", "thisWeek"], ["ongoing", "ongoing"]] as const) {
      const copied = department.items[category];
      if (copied.length !== previous.items[source].length || copied.some((item, position) => {
        const original = previous.items[source][position];
        return !Bun.deepEquals([item.title, item.content, item.notes, item.tables, item.assignee],
          [original.title, original.content, original.notes, original.tables, original.assignee]);
      })) throw new Error(`Rollover changed ${department.id} ${category}.`);
    }
  }
  await download("/api/week/hwpx", "out/u4-next.hwpx");
  console.log(`VERIFIED U4: versions 1 and 2, immutable version 1 JSON and hwpx, one next week (${next.titlePeriod}), copied plans and ongoing items.`);
  console.log(`SHA256 u4-v1.hwpx ${new Bun.CryptoHasher("sha256").update(firstBytes).digest("hex")} (identical on re-download)`);
}
