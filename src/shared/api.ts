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
export type ItemAction = "request-review" | "withdraw" | "approve" | "return";
export interface ReviewStage {
  id: number;
  organisationId: string;
  reviewerId: number;
  parentStageId: number | null;
  reviewUnit: "item" | "section";
}
export interface ItemVersion {
  id: number;
  number: number;
  requestedAt: number;
  requestedBy: number;
  changed: boolean;
  content: WorkItem;
}
export interface ReviewMessage {
  id: number;
  versionId: number;
  stageId: number;
  actorId: number;
  at: number;
  message: string;
}
export interface ItemReview {
  version: ItemVersion | null;
  messages: ReviewMessage[];
}
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
  actions: ItemAction[];
  review: ItemReview;
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
export interface SectionReview {
  stageId: number;
  status: ItemStatus;
  submittedAt: number;
  decidedAt: number | null;
  actorId: number;
  versionIds: number[];
  actions: ("approve" | "return")[];
}
export interface DashboardItem {
  id: string;
  category: WorkCategory;
  status: ItemStatus;
  changed: boolean;
  actions: ItemAction[];
}
export interface DashboardDepartment {
  departmentId: string;
  name: string;
  parentId: string | null;
  status: ItemStatus;
  counts: Record<ItemStatus, number>;
  items: DashboardItem[];
  reviews: SectionReview[];
}
export interface DashboardView {
  weekId: number;
  revision: number;
  pollIntervalMs: number;
  stages: (ReviewStage & { actions: "submit"[] })[];
  departments: DashboardDepartment[];
  offices: { organisationId: string; name: string; status: ItemStatus; departmentIds: string[] }[];
}
export type Todo =
  | { kind: "write" | "review-item"; itemId: string; departmentId: string; status: ItemStatus; actions: ItemAction[] }
  | { kind: "review-section"; departmentId: string; stageId: number; actions: ("approve" | "return")[] }
  | { kind: "submit"; stageId: number; actions: "submit"[] };
export interface TodoView {
  weekId: number;
  revision: number;
  pollIntervalMs: number;
  todos: Todo[];
}
export interface ReturnItemRequest { message: string }
export interface ReturnSectionRequest extends ReturnItemRequest { itemIds: string[] }
