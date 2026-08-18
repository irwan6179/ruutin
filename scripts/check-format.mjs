import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["app", "db", "docs", "scripts", "server", "tests", "worker"];
const extensions = new Set([".css", ".mjs", ".ts", ".tsx", ".md", ".json"]);
const ignored = new Set([".next", ".vinext", ".wrangler", "dist", "node_modules"]);
const failures = [];

async function filesIn(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(path)));
      continue;
    }
    if (extensions.has(path.slice(path.lastIndexOf(".")))) files.push(path);
  }
  return files;
}

for (const root of roots) {
  for (const file of await filesIn(root)) {
    const text = await readFile(file, "utf8");
    const name = relative(process.cwd(), file);
    if (/\r\n/.test(text)) failures.push(`${name}: use LF line endings`);
    // Markdown uses two trailing spaces for intentional hard line breaks.
    if (!name.endsWith(".md") && /[ \t]+$/m.test(text)) {
      failures.push(`${name}: trailing whitespace`);
    }
    if (text.length > 0 && !text.endsWith("\n")) failures.push(`${name}: missing final newline`);
  }
}

if (failures.length > 0) {
  console.error("Format check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Format check passed.");
}
