import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Organisation, Person } from "../shared/api";
import { seed } from "../shared/seed";
import { categories, type WeeklyPlan, type WorkItem } from "../shared/weekly-plan";
import { demoAccounts, headquarters, offices } from "./demo-accounts";

export const databasePath = process.env.DATABASE_PATH ?? "data/weekly-plan.sqlite";
export const personColumns = `p.id, p.employee_number AS employeeNumber, p.name, p.title, p.role,
  p.organisation_id AS organisationId,
  CASE WHEN o.kind = 'department' THEN o.id ELSE NULL END AS departmentId`;

export function people(db: Database): Person[] {
  return db.query<Person, []>(`SELECT ${personColumns} FROM people p
    JOIN organisations o ON o.id = p.organisation_id ORDER BY p.id`).all();
}

export function organisations(db: Database): Organisation[] {
  return db.query<Organisation, []>(`SELECT id, name, kind, parent_id AS parentId, position
    FROM organisations ORDER BY position`).all();
}

export function openDatabase(path = databasePath): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { strict: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS organisations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('headquarters','office','department')),
      parent_id TEXT REFERENCES organisations(id), position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY, employee_number TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      title TEXT NOT NULL, organisation_id TEXT NOT NULL REFERENCES organisations(id),
      role TEXT NOT NULL CHECK(role IN ('writer','departmentReviewer','officeReviewer','director'))
    );
    CREATE TABLE IF NOT EXISTS review_stages (
      id INTEGER PRIMARY KEY, organisation_id TEXT NOT NULL UNIQUE REFERENCES organisations(id),
      reviewer_id INTEGER NOT NULL REFERENCES people(id),
      parent_stage_id INTEGER REFERENCES review_stages(id), position INTEGER NOT NULL,
      review_unit TEXT NOT NULL CHECK(review_unit IN ('item','section'))
    );
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY, metadata_json TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_week ON weeks(is_current) WHERE is_current = 1;
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id),
      department_id TEXT NOT NULL REFERENCES organisations(id), labels_json TEXT NOT NULL,
      position INTEGER NOT NULL, UNIQUE(week_id, department_id)
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, section_id INTEGER NOT NULL REFERENCES sections(id),
      category TEXT NOT NULL CHECK(category IN ('lastWeek','thisWeek','ongoing')),
      position INTEGER NOT NULL, content_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('미작성','작성 중','검토 요청','수정 요청','승인')),
      creator_id INTEGER REFERENCES people(id),
      assignee_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(assignee_mode IN ('automatic','manual')),
      UNIQUE(section_id, category, position)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      item_id TEXT NOT NULL REFERENCES items(id), person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY(item_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS edit_locks (
      item_id TEXT PRIMARY KEY REFERENCES items(id), person_id INTEGER NOT NULL REFERENCES people(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id)
    );
    CREATE TABLE IF NOT EXISTS item_versions (
      id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id),
      number INTEGER NOT NULL, content_json TEXT NOT NULL,
      requested_at INTEGER NOT NULL, requested_by INTEGER NOT NULL REFERENCES people(id),
      changed INTEGER NOT NULL CHECK(changed IN (0,1)), UNIQUE(item_id, number)
    );
    CREATE TABLE IF NOT EXISTS review_sections (
      section_id INTEGER NOT NULL REFERENCES sections(id),
      stage_id INTEGER NOT NULL REFERENCES review_stages(id),
      status TEXT NOT NULL CHECK(status IN ('작성 중','검토 요청','수정 요청','승인')),
      versions_json TEXT NOT NULL, submitted_at INTEGER NOT NULL,
      decided_at INTEGER, actor_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY(section_id, stage_id)
    );
    CREATE TABLE IF NOT EXISTS review_records (
      id INTEGER PRIMARY KEY, stage_id INTEGER NOT NULL REFERENCES review_stages(id),
      section_id INTEGER NOT NULL REFERENCES sections(id),
      version_id INTEGER REFERENCES item_versions(id),
      action TEXT NOT NULL CHECK(action IN ('requested','withdrawn','approved','returned','submitted')),
      actor_id INTEGER NOT NULL REFERENCES people(id), at INTEGER NOT NULL,
      message TEXT, versions_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS change_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO change_revision VALUES (1, 0);
  `);
  // Upgrade the existing U2 database once; the workflow itself follows these rows.
  if (!db.query<{ name: string }, []>("PRAGMA table_info(review_stages)").all().some((column) => column.name === "review_unit")) {
    db.exec(`ALTER TABLE review_stages ADD COLUMN review_unit TEXT NOT NULL DEFAULT 'section'
      CHECK(review_unit IN ('item','section'));
      UPDATE review_stages SET review_unit = 'item' WHERE organisation_id IN
        (SELECT id FROM organisations WHERE kind = 'department');`);
  }
  for (const table of ["items", "assignments", "edit_locks", "sections", "review_sections", "review_records"]) {
    for (const action of ["INSERT", "UPDATE", "DELETE"]) db.exec(`
      CREATE TRIGGER IF NOT EXISTS revision_${table}_${action} AFTER ${action} ON ${table}
      BEGIN UPDATE change_revision SET revision = revision + 1 WHERE id = 1; END;
    `);
  }
  if (!db.query("SELECT id FROM weeks LIMIT 1").get()) {
    db.transaction(() => {
      const insertOrganisation = db.query("INSERT INTO organisations VALUES (?, ?, ?, ?, ?)");
      insertOrganisation.run(headquarters.id, headquarters.name, "headquarters", null, 0);
      offices.forEach((office, i) => insertOrganisation.run(office.id, office.name, "office", headquarters.id, i + 1));
      seed.departments.forEach((department, i) => insertOrganisation.run(
        department.id, department.name, "department",
        offices.find((office) => office.name === department.parentOffice)?.id ?? headquarters.id, i + 3,
      ));
      const insertPerson = db.query(`INSERT INTO people
        (employee_number, name, title, role, organisation_id) VALUES (?, ?, ?, ?, ?)`);
      for (const account of demoAccounts) insertPerson.run(
        account.employeeNumber, account.name, account.title, account.role, account.organisationId,
      );
      const stages = new Map<string, number>();
      for (const organisation of organisations(db)) {
        const reviewer = people(db).find((person) => person.organisationId === organisation.id && person.role !== "writer")!;
        const stage = db.query(`INSERT INTO review_stages
          (organisation_id, reviewer_id, parent_stage_id, position, review_unit) VALUES (?, ?, ?, ?, ?)`)
          .run(organisation.id, reviewer.id, stages.get(organisation.parentId ?? "") ?? null, organisation.position,
            organisation.kind === "department" ? "item" : "section");
        stages.set(organisation.id, Number(stage.lastInsertRowid));
      }
      const { departments, ...metadata } = seed;
      const week = db.query("INSERT INTO weeks (metadata_json, is_current) VALUES (?, 1)")
        .run(JSON.stringify(metadata));
      departments.forEach((department, position) => {
        const section = db.query(`INSERT INTO sections
          (week_id, department_id, labels_json, position) VALUES (?, ?, ?, ?)`)
          .run(Number(week.lastInsertRowid), department.id, JSON.stringify(department.labels), position);
        for (const category of categories) department.items[category].forEach((item, itemPosition) =>
          db.query(`INSERT INTO items (id, section_id, category, position, content_json, status)
            VALUES (?, ?, ?, ?, ?, '작성 중')`).run(
            item.id, Number(section.lastInsertRowid), category, itemPosition, JSON.stringify(item),
          ));
      });
    })();
  }
  return db;
}

export function readPlan(db: Database): WeeklyPlan {
  const week = db.query<{ id: number; metadata_json: string }, []>(
    "SELECT id, metadata_json FROM weeks WHERE is_current = 1",
  ).get()!;
  const sections = db.query<{
    id: number; department_id: string; name: string; parentOffice: string | null; labels_json: string;
  }, [number]>(`SELECT s.id, s.department_id, o.name,
    CASE WHEN parent.kind = 'office' THEN parent.name ELSE NULL END AS parentOffice, s.labels_json
    FROM sections s JOIN organisations o ON o.id = s.department_id
    LEFT JOIN organisations parent ON parent.id = o.parent_id
    WHERE week_id = ? ORDER BY s.position`).all(week.id);
  return {
    ...JSON.parse(week.metadata_json),
    departments: sections.map((section) => ({
      id: section.department_id, name: section.name,
      ...(section.parentOffice ? { parentOffice: section.parentOffice } : {}),
      labels: JSON.parse(section.labels_json),
      items: Object.fromEntries(categories.map((category) => [
        category, db.query<{ content_json: string }, [number, string]>(`SELECT content_json FROM items
          WHERE section_id = ? AND category = ? ORDER BY position`).all(section.id, category)
          .map((row): WorkItem => JSON.parse(row.content_json)),
      ])) as WeeklyPlan["departments"][number]["items"],
    })),
  };
}
