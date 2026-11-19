import type { Department, WeeklyPlan, WorkCategory, WorkItem } from "./weekly-plan";

export type OrganisationKind = "headquarters" | "office" | "department";
export interface Organisation {
  id: string;
  name: string;
  kind: OrganisationKind;
  parentId: string | null;
  position: number;
}
export type Role = "writer" | "departmentReviewer" | "officeReviewer" | "director";
export interface Person {
  id: number;
  employeeNumber: string;
  name: string;
  title: string;
  role: Role;
  organisationId: string;
  departmentId: string | null;
}
export const itemStatuses = ["미작성", "작성 중", "검토 요청", "수정 요청", "승인"] as const;
export type ItemStatus = (typeof itemStatuses)[number];
export interface EditLock {
  personId: number;
  name: string;
  expiresAt: number;
  message: string;
}
export interface ItemView extends WorkItem {
  departmentId: string;
  category: WorkCategory;
  status: ItemStatus;
  creatorId: number | null;
  assignedPeople: Person[];
  assigneeMode: "automatic" | "manual";
  lock: EditLock | null;
  canEdit: boolean;
}
export interface DepartmentView extends Omit<Department, "items"> {
  items: Record<WorkCategory, ItemView[]>;
}
export interface WeekView extends Omit<WeeklyPlan, "departments"> {
  id: number;
  departments: DepartmentView[];
}
export interface SignInRequest {
  name: string;
  employeeNumber: string;
  departmentId?: string;
  title?: string;
}
export interface CreateItemRequest {
  departmentId: string;
  category: WorkCategory;
}
export interface SaveItemRequest extends Pick<WorkItem, "title" | "content" | "notes" | "tables"> {
  /** Omitted: retain mode/text. String: manual override. Null: return to automatic text. */
  assignee?: string | null;
}
export interface ApiError {
  error: string;
  code?: string;
  lock?: EditLock;
}
