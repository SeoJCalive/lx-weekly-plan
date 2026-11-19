import { mkdir } from "node:fs/promises";
import type {
  DeadlineView, DashboardView, ItemHistory, ItemView, Person, SaveItemRequest, StatisticsView, WeekView,
} from "../src/shared/api";

// Run against a fresh, dedicated database with the server already listening.
const base = process.env.API_URL ?? "http://127.0.0.1:4310";
const cookies = new Map<string, string>();
async function curl(args: string[]): Promise<string> {
  const child = Bun.spawn(["curl", "--silent", "--show-error", ...args], {
    env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exit !== 0) throw new Error(`curl failed (${exit}): ${error}\n${output}`);
  return output;
}
async function request<T>(method: string, path: string, account = "", body?: unknown, expected = 200): Promise<T> {
  const args = ["-i", "-X", method, `${base}${path}`];
  if (account) args.push("-H", `Cookie: ${cookies.get(account)}`);
  if (body !== undefined) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  const output = await curl(args), boundary = output.indexOf("\r\n\r\n");
  const headers = output.slice(0, boundary), result = JSON.parse(output.slice(boundary + 4));
  const status = Number(headers.split(" ")[1]);
  if (status !== expected) throw new Error(`${method} ${path}: ${status} ${JSON.stringify(result)}`);
  const cookie = /set-cookie:\s*([^;\r\n]+)/i.exec(headers)?.[1];
  if (cookie && body) cookies.set((body as Person).employeeNumber, cookie);
  console.log(`${method} ${path} -> ${status}`);
  return result;
}
async function download(path: string, output: string, account: string): Promise<void> {
  await curl(["--fail-with-body", "-H", `Cookie: ${cookies.get(account)}`, "-o", output, `${base}${path}`]);
  console.log(`GET ${path} -> ${output}, ${Bun.file(output).size} bytes`);
}
const accounts = await request<Person[]>("GET", "/api/accounts");
for (const employeeNumber of ["W1001", "W2001", "R0001", "O0002", "D0001"]) {
  const account = accounts.find((person) => person.employeeNumber === employeeNumber)!;
  await request("POST", "/api/session", "", { name: account.name, employeeNumber });
}
const week = await request<WeekView>("GET", "/api/week", "D0001");
const budget = week.departments.find((department) => department.name === "예산법무처")!;
await mkdir("out", { recursive: true });
await download("/api/week/hwpx", "out/u6-whole.hwpx", "D0001");
await download(`/api/week/hwpx?organisationId=${budget.id}`, "out/u6-dept.hwpx", "W2001");
await download("/api/week/hwpx?organisationId=office-digital", "out/u6-office.hwpx", "O0002");
await request("GET", "/api/week/hwpx?organisationId=office-planning", "W1001", undefined, 403);
await request("GET", `/api/week/hwpx?organisationId=${budget.id}`, "W1001", undefined, 403);

const initialDeadline = await request<DeadlineView>("GET", "/api/deadline", "D0001");
console.log("DEFAULT DEADLINE", JSON.stringify(initialDeadline));
const future = await request<DeadlineView>("PUT", "/api/deadline", "D0001", { deadlineAt: Date.now() + 86_400_000 });
if (future.passed) throw new Error("Future deadline must not be passed.");
console.log("FUTURE DEADLINE", JSON.stringify(future));
await request("PUT", "/api/deadline", "W1001", { deadlineAt: future.deadlineAt }, 403);
const past = await request<DeadlineView>("PUT", "/api/deadline", "D0001", { deadlineAt: Date.now() - 1 });
if (!past.passed) throw new Error("Past deadline must be passed.");
console.log("PAST DEADLINE", JSON.stringify(past));

const department = week.departments[0], item = department.items.ongoing[1];
const action = (id: string, name: string, account: string, body?: unknown) =>
  request<ItemView>("POST", `/api/items/${id}/${name}`, account, body);
async function save(notes: string): Promise<void> {
  await action(item.id, "lock", "W1001");
  const input: SaveItemRequest = {
    title: item.title, content: item.content, notes: [[{ text: notes }]], tables: item.tables,
  };
  await request("PUT", `/api/items/${item.id}`, "W1001", input);
}
await action(item.id, "assignment", "W1001");
await save(" * U6 중간 저장");
const empty = await request<ItemHistory>("GET", `/api/items/${item.id}/history`, "W1001");
if (empty.entries.length !== 0) throw new Error("Interim save appeared in history.");
await action(item.id, "request-review", "W1001");
await action(item.id, "return", "R0001", { message: "검토 근거를 보완하세요." });
await save(" * U6 검토 근거 보완");
await action(item.id, "request-review", "W1001");
await action(item.id, "approve", "R0001");
const history = await request<ItemHistory>("GET", `/api/items/${item.id}/history`, "W1001");
if (history.entries.map((entry) => entry.action).join(",") !== "requested,returned,requested,approved" ||
  history.entries[2].changes.map((change) => change.field).join(",") !== "notes")
  throw new Error("History or differences did not match the scenario.");
console.log("HISTORY", JSON.stringify(history, null, 2));
for (const row of Object.values(department.items).flat()) {
  if (row.id === item.id) continue;
  await action(row.id, "assignment", "W1001");
  await action(row.id, "request-review", "W1001");
  await action(row.id, "approve", "R0001");
}
const dashboard = await request<DashboardView>("GET", "/api/dashboard", "R0001");
const stage = dashboard.stages.find((stage) => stage.organisationId === department.id)!;
await request("POST", `/api/review-stages/${stage.id}/submit`, "R0001");
const late = await request<StatisticsView>("GET", "/api/statistics", "D0001");
if (late.departments[0].revisions !== 1 || late.departments[0].revisionRequests !== 1 ||
  late.departments[0].deadlineMet !== false) throw new Error("Late statistics did not match.");
console.log("STATISTICS AFTER DEADLINE", JSON.stringify(late, null, 2));
await request("PUT", "/api/deadline", "D0001", { deadlineAt: future.deadlineAt });
const extended = await request<StatisticsView>("GET", "/api/statistics", "D0001");
if (!extended.departments[0].deadlineMet) throw new Error("Extension did not recompute compliance.");
console.log("STATISTICS AFTER EXTENSION", JSON.stringify(extended, null, 2));
console.log("VERIFIED U6 CURL: exact history/diff, statistics, past/future deadline, submission after deadline, scoped downloads.");
