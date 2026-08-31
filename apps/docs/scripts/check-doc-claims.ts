#!/usr/bin/env bun
/**
 * Walk apps/docs/src/content/docs MDX files and fail dishonest @paykernel/
 * specifiers.
 *
 * Known publishable names = packages/<pkg>/package.json "name" plus documented
 * export subpaths. Fail:
 *   - unknown @paykernel/<name> (unless a same-line "does not exist" warning)
 *   - @paykernel/observability as an import/install, or as a non-warning mention
 *   - install/import of @paykernel/internal-sql-store
 *
 * Usage (from repo root or apps/docs):
 *   bun apps/docs/scripts/check-doc-claims.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_APP_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(DOCS_APP_ROOT, "../..");
const MDX_ROOT = join(DOCS_APP_ROOT, "src/content/docs");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

const SPECIFIER_RE =
  /@paykernel\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*/g;

const OBSERVABILITY = "@paykernel/observability";
const INTERNAL_SQL_STORE = "@paykernel/internal-sql-store";

const INSTALL_PM_RE =
  /\b(?:npm|pnpm|yarn|bunx?|npx)\s+(?:add|i|install|dlx)\b/;

const IMPORT_FROM_RE =
  /\b(?:from|import|require)\s*(?:\(\s*)?['"](@paykernel\/[^'"]+)['"]/;

type PkgJson = {
  name?: unknown;
  private?: unknown;
  exports?: unknown;
};

type Finding = {
  file: string;
  line: number;
  specifier: string;
  message: string;
};

function readJson(path: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

function listImmediateDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function loadPackageJson(dir: string): PkgJson | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  return readJson(path);
}

function exportSubpaths(exportsField: unknown): string[] {
  if (!exportsField || typeof exportsField !== "object") return [];
  const keys = Object.keys(exportsField as Record<string, unknown>);
  const out: string[] = [];
  for (const key of keys) {
    if (key === ".") continue;
    if (key.startsWith("./")) out.push(key.slice(2));
  }
  return out;
}

function loadKnown(): {
  publishable: Set<string>;
  specifiers: Set<string>;
  workspacePrivate: Set<string>;
} {
  const publishable = new Set<string>();
  const specifiers = new Set<string>();
  const workspacePrivate = new Set<string>();

  for (const dir of listImmediateDirs(PACKAGES_DIR)) {
    const pkg = loadPackageJson(join(PACKAGES_DIR, dir));
    if (!pkg || typeof pkg.name !== "string") continue;
    const name = pkg.name;
    if (pkg.private === true) {
      workspacePrivate.add(name);
    } else {
      publishable.add(name);
    }
    specifiers.add(name);
    for (const sub of exportSubpaths(pkg.exports)) {
      specifiers.add(`${name}/${sub}`);
    }
  }

  for (const group of ["internal", "examples", "apps"] as const) {
    for (const dir of listImmediateDirs(join(REPO_ROOT, group))) {
      const pkg = loadPackageJson(join(REPO_ROOT, group, dir));
      if (!pkg || typeof pkg.name !== "string") continue;
      workspacePrivate.add(pkg.name);
      specifiers.add(pkg.name);
      for (const sub of exportSubpaths(pkg.exports)) {
        specifiers.add(`${pkg.name}/${sub}`);
      }
    }
  }

  return { publishable, specifiers, workspacePrivate };
}

function walkMdx(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walkMdx(path));
    else if (name.endsWith(".mdx")) out.push(path);
  }
  return out.sort();
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  // @paykernel / name / optional subpath
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return specifier;
}

function isGlobRemainder(after: string): boolean {
  return after.startsWith("*") || after.startsWith("-*");
}

function isDiscouragingLine(line: string): boolean {
  return (
    /\bnever\b/i.test(line) ||
    /\bdo not\b/i.test(line) ||
    /\bdon't\b/i.test(line) ||
    /\bdoes not\b/i.test(line) ||
    /\bis not\b/i.test(line) ||
    /\bare not\b/i.test(line) ||
    /\bthere is no\b/i.test(line) ||
    /\bthere is \*\*no\*\*/i.test(line) ||
    /\bnot a\b/i.test(line) ||
    /\bno\s+`/i.test(line) ||
    /\*\*no\*\*/.test(line) ||
    /\*\*not\*\*/.test(line) ||
    /\*\*private\*\*/.test(line) ||
    /\bnot published\b/i.test(line)
  );
}

function isInstallOrImportLine(line: string, specifier: string): boolean {
  if (INSTALL_PM_RE.test(line)) return true;
  if (new RegExp(`['"]${escapeRegExp(specifier)}['"]\\s*:`).test(line)) {
    return true;
  }
  const imported = line.match(IMPORT_FROM_RE);
  if (imported?.[1] === specifier) return true;
  if (
    new RegExp(
      `\\bimport\\s+[^;\\n]*\\bfrom\\s+['"]${escapeRegExp(specifier)}['"]`,
    ).test(line)
  ) {
    return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rel(path: string): string {
  return relative(REPO_ROOT, path).split("\\").join("/");
}

function checkLine(
  file: string,
  lineNo: number,
  line: string,
  known: ReturnType<typeof loadKnown>,
): Finding[] {
  const findings: Finding[] = [];
  SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPECIFIER_RE.exec(line)) !== null) {
    const specifier = match[0];
    const after = line.slice(match.index + specifier.length);
    if (isGlobRemainder(after)) continue;

    const installOrImport = isInstallOrImportLine(line, specifier);
    const pkgName = packageNameOf(specifier);
    const discouraging = isDiscouragingLine(line);

    if (pkgName === OBSERVABILITY || specifier.startsWith(`${OBSERVABILITY}/`)) {
      findings.push({
        file,
        line: lineNo,
        specifier,
        message: installOrImport
          ? "forbidden @paykernel/observability (import/install). Publish name is @paykernel/opentelemetry"
          : discouraging
            ? ""
            : "forbidden @paykernel/observability — folder packages/observability publishes as @paykernel/opentelemetry",
      });
      continue;
    }

    if (pkgName === INTERNAL_SQL_STORE) {
      if (installOrImport && !discouraging) {
        findings.push({
          file,
          line: lineNo,
          specifier,
          message:
            "do not install/import @paykernel/internal-sql-store (private BC shim over @paykernel/sql-foundation)",
        });
      }
      continue;
    }

    if (known.specifiers.has(specifier)) continue;

    const pkgKnown =
      known.publishable.has(pkgName) || known.workspacePrivate.has(pkgName);
    if (pkgKnown && specifier !== pkgName) {
      if (installOrImport || !discouraging) {
        findings.push({
          file,
          line: lineNo,
          specifier,
          message: `unknown subpath ${specifier} (not in package.json exports)`,
        });
      }
      continue;
    }

    if (pkgKnown) continue;

    if (installOrImport) {
      findings.push({
        file,
        line: lineNo,
        specifier,
        message: `unknown @paykernel specifier ${specifier} (not in packages/*/package.json names or exports)`,
      });
      continue;
    }

    if (!discouraging) {
      findings.push({
        file,
        line: lineNo,
        specifier,
        message: `unknown @paykernel specifier ${specifier} (not in packages/*/package.json names or exports)`,
      });
    }
  }
  return findings.filter((f) => f.message.length > 0);
}

function selfTest(known: ReturnType<typeof loadKnown>): string[] {
  const cases: Array<{ line: string; mustFail: boolean; label: string }> = [
    {
      line: 'import { x } from "@paykernel/observability";',
      mustFail: true,
      label: "observability import",
    },
    {
      line: "bun add @paykernel/internal-sql-store",
      mustFail: true,
      label: "internal-sql-store install",
    },
    {
      line: 'import { x } from "@paykernel/gateway-stripe";',
      mustFail: true,
      label: "unknown gateway-stripe import",
    },
    {
      line: 'import { money } from "@paykernel/core";',
      mustFail: false,
      label: "core import",
    },
    {
      line: "Never `@paykernel/observability`.",
      mustFail: false,
      label: "observability warning mention",
    },
    {
      line: "Do not install `@paykernel/internal-sql-store`.",
      mustFail: false,
      label: "internal-sql-store warning mention",
    },
    {
      line: "There is **no** `@paykernel/gateway-stripe` package.",
      mustFail: false,
      label: "gateway-stripe absence mention",
    },
    {
      line: 'import { x } from "@paykernel/opentelemetry/otel";',
      mustFail: false,
      label: "opentelemetry otel subpath",
    },
    {
      line: 'import { x } from "@paykernel/store-turso/sync";',
      mustFail: true,
      label: "turso sync subpath import",
    },
  ];
  const errors: string[] = [];
  for (const c of cases) {
    const found = checkLine("self-test.mdx", 1, c.line, known);
    const failed = found.length > 0;
    if (failed !== c.mustFail) {
      errors.push(
        `self-test ${c.label}: expected fail=${c.mustFail} got fail=${failed} (${found.map((f) => f.message).join("; ") || "clean"})`,
      );
    }
  }
  return errors;
}

function main(): number {
  if (!existsSync(join(PACKAGES_DIR, "core", "package.json"))) {
    console.error(
      `check-doc-claims: expected packages/core/package.json under ${REPO_ROOT}`,
    );
    return 2;
  }
  if (!existsSync(MDX_ROOT)) {
    console.error(`check-doc-claims: missing MDX root ${MDX_ROOT}`);
    return 2;
  }

  const known = loadKnown();
  if (known.publishable.size === 0) {
    console.error("check-doc-claims: no publishable packages found");
    return 2;
  }

  const selfTestErrors = selfTest(known);
  if (selfTestErrors.length > 0) {
    for (const msg of selfTestErrors) console.error(msg);
    return 2;
  }

  const files = walkMdx(MDX_ROOT);
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      findings.push(...checkLine(file, i + 1, lines[i]!, known));
    }
  }

  if (findings.length > 0) {
    for (const f of findings) {
      console.error(`${rel(f.file)}:${f.line}: ${f.message}`);
    }
    console.error(
      `check-doc-claims: ${findings.length} finding(s) in ${files.length} MDX file(s); ${known.publishable.size} publishable package names`,
    );
    return 1;
  }

  console.log(
    `check-doc-claims: ok (${files.length} MDX files, ${known.publishable.size} publishable packages, ${known.specifiers.size} known specifiers)`,
  );
  return 0;
}

const code = main();
process.exit(code);
