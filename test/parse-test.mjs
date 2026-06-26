/**
 * Local parser test — runs parseImports / parseCalls against every snippet in
 * test/fixtures/ and prints what each extracts. No network required.
 *
 * Usage:
 *   node test/parse-test.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

import { parseImports } from '../src/parsers/parseImports.js';
import { parseCalls } from '../src/parsers/parseCalls.js';
import { parseSymbols } from '../src/parsers/parseSymbols.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dir, 'fixtures');

const files = readdirSync(fixturesDir).sort();

let imported = 0;
let withCalls = 0;
let withSymbols = 0;

for (const file of files) {
  const ext = extname(file);
  const content = readFileSync(resolve(fixturesDir, file), 'utf8');

  const imports = parseImports(content, ext, file);
  const calls = parseCalls(content, ext);
  const { symbols, edges } = parseSymbols(content, ext);

  if (imports.length) imported++;
  if (calls.length) withCalls++;
  if (symbols.length) withSymbols++;

  const fns = symbols.filter(s => s.kind === 'function').map(s => s.name);
  const vars = symbols.filter(s => s.kind === 'variable').map(s => s.name);

  console.log(`\n=== ${file} ===`);
  console.log(`  imports (${imports.length}): ${imports.length ? imports.map(i => `${i.spec}@L${i.line}`).join(', ') : '—'}`);
  console.log(`  calls   (${calls.length}): ${calls.length ? calls.map(c => `${c.caller}→${c.callee}@L${c.line}`).join(', ') : '—'}`);
  console.log(`  functions (${fns.length}): ${fns.length ? fns.join(', ') : '—'}`);
  console.log(`  variables (${vars.length}): ${vars.length ? vars.join(', ') : '—'}`);
  console.log(`  symbol edges (${edges.length}): ${edges.length ? edges.map(e => `${e.from}→${e.to}`).join(', ') : '—'}`);
}

console.log(`\n${files.length} fixtures · ${imported} imports · ${withCalls} call edges · ${withSymbols} symbols`);
