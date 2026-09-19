// The promise `portable.ts` makes, held by a machine.
//
// ⛔ WHAT IT WALKS IS THE BUILD, NOT THE SOURCE. TypeScript erases a type-only import, so a source
//    file that imports a TYPE from a module full of `node:fs` does not drag that module into the
//    program at all. Reading the sources would fail on modules the browser never loads; reading
//    `dist/` is reading what a bundler will read.
//
// ⛔ AND IT WALKS THE CLOSURE, NOT THE ENTRY. A module one import further in is just as fatal to a
//    page as one named directly, and it is the one nobody thinks to check.
//
// ⛔ IT PARSES RATHER THAN GREPS. `process.` and `Buffer.` appear in the prose of these files often
//    and legitimately — "the rest of the process.", "`Buffer.from` copies" — and a check that
//    failed on a sentence would teach people to write worse sentences. The compiler's own parser
//    says which of them is code.
//
// ⚠ IT NEEDS `npm run compile` FIRST. A missing build is a failure here rather than a skip: a
//   check that quietly passes when it did not run is worse than no check.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

import ts from "typescript";

const DIST = join(import.meta.dirname, "..", "dist");
const ENTRY = join(DIST, "portable.js");

/** What may not be reached from the portable entry, and what each one would break. */
const FORBIDDEN = {
  node: "imports a `node:` module",
  process: "reads `process`",
  buffer: "uses `Buffer`",
  importMeta: "reads `import.meta.url`",
} as const;

interface Finding {
  file: string;
  line: number;
  what: string;
}

/** Every relative import and dynamic import in one built file, resolved to a path. */
function importsOf(source: ts.SourceFile, file: string, found: Finding[]): string[] {
  const out: string[] = [];
  const note = (node: ts.Node, what: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ file, line: line + 1, what });
  };
  const take = (specifier: string, node: ts.Node): void => {
    if (specifier.startsWith("node:")) {
      note(node, `${FORBIDDEN.node} (${specifier})`);
      return;
    }
    if (!specifier.startsWith(".")) return;
    const resolved = resolve(dirname(file), specifier);
    if (existsSync(resolved)) out.push(resolved);
  };
  const walk = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) take(node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) take(first.text, node);
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "process") note(node, `${FORBIDDEN.process} (process.${node.name.text})`);
      if (node.expression.text === "Buffer") note(node, `${FORBIDDEN.buffer} (Buffer.${node.name.text})`);
    } else if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)) {
      if (node.name.text === "url") note(node, FORBIDDEN.importMeta);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return out;
}

test("nothing the portable entry reaches needs Node", () => {
  assert.ok(
    existsSync(ENTRY),
    `${relative(process.cwd(), ENTRY)} is not built. Run \`npm run compile\` before \`npm test\`.`,
  );
  const seen = new Set<string>();
  const found: Finding[] = [];
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const next of importsOf(source, file, found)) queue.push(next);
  }
  // ⛔ The closure has to be a real one. A resolver that quietly found nothing would make this
  //    test pass by walking one file.
  assert.ok(seen.size > 20, `only ${seen.size} files were walked, so nothing was judged`);
  assert.deepEqual(
    found.map((f) => `${relative(DIST, f.file)}:${f.line} ${f.what}`),
    [],
    "the portable entry reaches code that only runs in Node",
  );
});
