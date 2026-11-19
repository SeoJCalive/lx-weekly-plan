import type { DashboardView, ItemView, Person, WeekView } from "../src/shared/api";

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
await edit(" * 시연 작성");
await itemAction(item8.id, "request-review", "W1001");
await itemAction(item8.id, "return", "R0001", { message: "검토 근거를 보완하세요." });
await edit(" * 시연 검토 근거 보완");
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
