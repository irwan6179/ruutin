import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const secretKeys = ["EMAIL_API_KEY", "AUTH_HMAC_SECRET", "SESSION_SECRET"];
const clientRoots = ["app"];
const outputRoots = ["dist/client"];
const failures = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function filesIn(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files;
}

for (const root of clientRoots) {
  for (const file of await filesIn(root)) {
    const text = await readFile(file, "utf8");
    const isClientModule = /^\s*["']use client["'];/m.test(text);
    if (!isClientModule) continue;

    for (const key of secretKeys) {
      if (text.includes(key)) failures.push(`${file}: client code references ${key}`);
    }
    if (/from\s+["'][^"']*(?:server|runtime-config)[^"']*["']/.test(text)) {
      failures.push(`${file}: client code imports server configuration`);
    }
  }
}

const envFiles = [".env", ".env.local", ".env.production", ".env.example"];
const values = [];
for (const file of envFiles) {
  if (!(await exists(file))) continue;
  const text = await readFile(file, "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']?([^"'#\s]+)["']?\s*$/);
    if (!match || !secretKeys.includes(match[1])) continue;
    if (/^(?:your_|replace_|changeme|example|test_|\$\{)/i.test(match[2])) continue;
    if (match[2].length >= 8) values.push(match[2]);
  }
}

for (const root of outputRoots) {
  for (const file of await filesIn(root)) {
    const text = await readFile(file, "utf8");
    for (const key of secretKeys) {
      if (text.includes(key)) failures.push(`${file}: client output references ${key}`);
    }
    for (const value of values) {
      if (text.includes(value)) failures.push(`${file}: contains a configured secret value`);
    }
  }
}

if (failures.length > 0) {
  console.error("Secret/client-bundle scan failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Secret/client-bundle scan passed (no configured secret values found).");
}
