import { createApp } from "./app";
import { openDatabase } from "./database";
import ui from "../ui/index.html";

const db = openDatabase();
const templateBytes = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const server = Bun.serve({
  port: Number(process.env.PORT ?? 4310),
  hostname: process.env.HOST ?? "127.0.0.1",
  routes: { "/": ui },
  fetch: createApp({ db, templateBytes }),
});
console.log(`LX weekly-plan server: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  server.stop(true);
  db.close();
  process.exit(0);
});
