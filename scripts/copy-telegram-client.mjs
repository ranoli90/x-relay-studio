import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy teleproto + CJS leftovers into the Vercel function so runtime requires resolve. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const func = join(root, ".vercel/output/functions/__server.func");
if (!existsSync(func)) process.exit(0);

const destRoot = join(func, "node_modules");
mkdirSync(destRoot, { recursive: true });

const copied = new Set();

function copyPkg(name) {
  if (!name || name.startsWith(".") || copied.has(name)) return;
  copied.add(name);
  const from = join(root, "node_modules", name);
  if (!existsSync(from)) {
    console.warn("[copy-telegram-client] missing", name);
    return;
  }
  const to = join(destRoot, name);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  try {
    const pkg = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) copyPkg(dep);
  } catch {
    /* ignore */
  }
}

for (const name of [
  "teleproto",
  "big-integer",
  "mime",
  "socks",
  "store2",
  "node-localstorage",
]) {
  copyPkg(name);
}

console.log("[copy-telegram-client] copied", [...copied].sort().join(", "));
