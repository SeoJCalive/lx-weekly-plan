import type { Role } from "../shared/api";

export const roles: Record<Role, string> = {
  writer: "작성자", departmentReviewer: "처 검토자", officeReviewer: "실 검토자", director: "최종 승인자",
};
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) window.dispatchEvent(new Event("lx:signed-out"));
  if (!response.ok) throw Object.assign(new Error((await response.json()).error), { status: response.status });
  return response.status === 204 ? undefined as T : response.json();
}
