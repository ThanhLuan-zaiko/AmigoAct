#!/usr/bin/env bun
/**
 * Enforce the repository's file-size ceilings.
 *
 * AmigoAct caps source files so that every file stays reviewable in one sitting:
 *
 *   .py   <= 400 lines
 *   .tsx  <= 260 lines
 *   .ts   <= 350 lines
 *
 * When a file crosses its ceiling, split it rather than growing it further.
 * Limits live in `scripts/file-limits.config.json` — this file is only the
 * engine, so the numbers can be adjusted without touching code.
 *
 * Usage:
 *   bun run scripts/check-file-size.mjs            # check the whole repo
 *   bun run scripts/check-file-size.mjs --staged   # check staged files only
 *   bun run scripts/check-file-size.mjs --json     # machine-readable output
 *
 * Exit codes:
 *   0  every checked file is within its ceiling
 *   1  at least one file is over its ceiling
 *   2  the script itself failed (bad config, unreadable file)
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = join(SCRIPT_DIR, "file-limits.config.json");

/** @typedef {{ path: string, limit: number, lines: number, over: number }} Violation */
/** @typedef {{ path: string, limit: number, lines: number }} FileReport */

/**
 * Load and validate the limits config.
 * @returns {Promise<{limits: Record<string, number>, ignoredDirectories: Set<string>, ignoreGlobs: string[], exemptions: Map<string, string>}>}
 */
async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.limits || typeof parsed.limits !== "object") {
    throw new Error(`${CONFIG_PATH}: "limits" must be an object`);
  }
  for (const [ext, value] of Object.entries(parsed.limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${CONFIG_PATH}: limit for ".${ext}" must be a positive integer`);
    }
  }
  return {
    limits: parsed.limits,
    ignoredDirectories: new Set(parsed.ignoredDirectories ?? []),
    ignoreGlobs: parsed.ignoreGlobs ?? [],
    exemptions: new Map(
      (parsed.exemptions ?? []).map((entry) => [entry.path, entry.reason ?? "no reason given"]),
    ),
  };
}

/**
 * Convert a path to a POSIX-style relative path with a leading `./` so the
 * report reads consistently.
 * @param {string} absolute
 * @returns {string}
 */
function toPosixRelative(absolute) {
  const rel = relative(REPO_ROOT, absolute);
  return `./${rel.split(sep).join("/")}`;
}

/**
 * Convert a path to a POSIX-style relative path with no `./` prefix, which is
 * the form the `ignoreGlobs` patterns are written against.
 * @param {string} absolute
 * @returns {string}
 */
function toGlobPath(absolute) {
  return relative(REPO_ROOT, absolute).split(sep).join("/");
}

/**
 * Match a path against a `**`-style glob, as used in `ignoreGlobs`.
 * Only the subset of glob syntax the config actually uses is supported.
 * @param {string} filePath posix-style relative path without a `./` prefix
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesGlob(filePath, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

/**
 * Recursively collect every scannable source file under `dir`.
 * @param {string} dir absolute path
 * @param {{ignoredDirectories: Set<string>, limits: Record<string, number>}} config
 * @returns {Promise<string[]>}
 */
async function collectFiles(dir, config) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (config.ignoredDirectories.has(entry.name)) continue;
      found.push(...(await collectFiles(absolute, config)));
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = entry.name.split(".").pop() ?? "";
    if (!(extension in config.limits)) continue;

    if (config.ignoreGlobs.some((pattern) => matchesGlob(toGlobPath(absolute), pattern)))
      continue;

    found.push(absolute);
  }
  return found;
}

/**
 * Count the lines in a file, ignoring a single trailing newline.
 * @param {string} absolute
 * @returns {Promise<number>}
 */
async function countLines(absolute) {
  const content = await readFile(absolute, "utf8");
  if (content.length === 0) return 0;
  const withoutTrailing = content.replace(/\r?\n$/, "");
  return withoutTrailing.split(/\r?\n/).length;
}

/**
 * Build the list of files to check.
 * @param {{ignoredDirectories: Set<string>, limits: Record<string, number>}} config
 * @param {string[]} argv
 * @returns {Promise<string[]>}
 */
async function resolveTargets(config, argv) {
  const staged = argv.includes("--staged");
  if (!staged) {
    return collectFiles(REPO_ROOT, config);
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const { stdout } = await run("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: REPO_ROOT,
  });

  const targets = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const absolute = resolve(REPO_ROOT, line);
    if (!(await stat(absolute).catch(() => null))) continue;
    const extension = line.split(".").pop() ?? "";
    if (!(extension in config.limits)) continue;
    if (config.ignoreGlobs.some((pattern) => matchesGlob(line.split(sep).join("/"), pattern)))
      continue;
    targets.push(absolute);
  }
  return targets;
}

/** @param {string[]} argv */
async function main(argv) {
  const config = await loadConfig();
  const targets = await resolveTargets(config, argv);

  /** @type {FileReport[]} */
  const reports = [];
  /** @type {Violation[]} */
  const violations = [];

  for (const absolute of targets) {
    const extension = absolute.split(".").pop() ?? "";
    const limit = config.limits[extension];
    if (!limit) continue;

    const lines = await countLines(absolute);
    const posixPath = toPosixRelative(absolute);
    reports.push({ path: posixPath, limit, lines });

    if (lines > limit) {
      violations.push({ path: posixPath, limit, lines, over: lines - limit });
    }
  }

  reports.sort((a, b) => b.lines / b.limit - a.lines / a.limit);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ reports, violations }, null, 2));
    process.exit(violations.length > 0 ? 1 : 0);
  }

  const width = Math.max(0, ...reports.map((r) => r.path.length));
  console.log("File size limits — most-utilised first\n");
  for (const report of reports) {
    const pct = Math.round((report.lines / report.limit) * 100);
    const exempt = config.exemptions.get(report.path);
    const marker = report.lines > report.limit ? " OVER" : pct >= 90 ? "  ~ " : "    ";
    const exemptNote = exempt ? `  [exempt: ${exempt}]` : "";
    console.log(
      `${marker} ${report.path.padEnd(width)}  ${String(report.lines).padStart(4)}/${report.limit}  ${String(pct).padStart(3)}%${exemptNote}`,
    );
  }

  console.log("");
  if (violations.length === 0) {
    console.log(`OK — ${reports.length} file(s) within limits.`);
    return;
  }

  console.error(`FAIL — ${violations.length} file(s) over the limit:\n`);
  for (const violation of violations) {
    console.error(
      `  ${violation.path}: ${violation.lines} lines exceeds the ${violation.limit}-line ceiling by ${violation.over}.`,
    );
  }
  console.error(
    "\nSplit the file before adding more code to it. See AGENTS.md > File size limits.",
  );
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`check-file-size: ${error.message}`);
  process.exit(2);
});
