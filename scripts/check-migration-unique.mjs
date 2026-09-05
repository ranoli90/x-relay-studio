#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = readdirSync(root).filter((name) => name.endsWith(".sql"));
const prefixes = new Map();
let failed = false;

for (const name of files) {
  const match = name.match(/^(\d{4})_/);
  if (!match) {
    console.error(`migration without NNNN_ prefix: ${name}`);
    failed = true;
    continue;
  }
  const key = match[1];
  const prev = prefixes.get(key);
  if (prev) {
    console.error(`duplicate migration number ${key}: ${prev} and ${name}`);
    failed = true;
    continue;
  }
  prefixes.set(key, name);
}

if (failed) {
  process.exit(1);
}

console.log(`ok: ${files.length} migrations, unique prefixes`);
