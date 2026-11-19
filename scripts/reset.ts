import { rmSync } from "node:fs";
import { databasePath, openDatabase } from "../src/server/database";

// Stop the dev server before resetting so it cannot retain an open database.
for (const suffix of ["", "-wal", "-shm"]) rmSync(databasePath + suffix, { force: true });
openDatabase().close();
console.log(`Reset ${databasePath} from the first-week seed.`);
