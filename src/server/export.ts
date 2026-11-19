import { mkdir } from "node:fs/promises";
import { seed } from "../shared/seed";
import { generateHwpx } from "./hwpx";

const template = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
await mkdir("out", { recursive: true });
const path = "out/weekly-plan.hwpx";
await Bun.write(path, generateHwpx(seed, template));
console.log(path);
