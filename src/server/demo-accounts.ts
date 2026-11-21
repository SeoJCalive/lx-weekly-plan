import type { Role } from "../shared/api";
import { seed } from "../shared/seed";

// Employee numbers and reviewer names are fictional demo data.
export const headquarters = { id: "headquarters", name: "기획혁신본부" };
export const offices = [
  { id: "office-planning", name: "기획조정실" },
  { id: "office-digital", name: "AI디지털전략실" },
];
export interface DemoAccount {
  employeeNumber: string;
  name: string;
  title: string;
  role: Role;
  organisationId: string;
}
const writers = [
  [["나현수", "책임"], ["방지원", "선임"], ["권태식", "과장"]],
  [["안재형", "과장"], ["허윤정", "과장"], ["우성민", "대리"]],
  [["설다은", "대리"], ["함도현", "대리"], ["금현우", "선임"]],
  [["양세진", "과장"], ["유미란", "대리"], ["차현우", "선임"]],
  [["홍석진", "과장"], ["노은지", "대리"], ["백승우", "선임"]],
];
const officeReviewers = ["서민철", "강지훈"];
const departmentReviewers = ["최영수", "문성일", "배준호", "임동혁", "권혜진"];
export const demoAccounts: DemoAccount[] = [
  { employeeNumber: "D0001", name: "윤재석", title: "본부장", role: "director", organisationId: headquarters.id },
  ...offices.map((office, i): DemoAccount => ({
    employeeNumber: `O000${i + 1}`, name: officeReviewers[i],
    title: "실장", role: "officeReviewer", organisationId: office.id,
  })),
  ...seed.departments.flatMap((department, i): DemoAccount[] => [
    {
      employeeNumber: `R000${i + 1}`, name: departmentReviewers[i], title: "처장",
      role: "departmentReviewer", organisationId: department.id,
    },
    ...writers[i].map(([name, title], j): DemoAccount => ({
      employeeNumber: `W${i + 1}00${j + 1}`, name, title, role: "writer", organisationId: department.id,
    })),
  ]),
];
