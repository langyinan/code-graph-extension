/**
 * Shared, heuristic (regex-based) extractors for top-level declarations across
 * languages. Used by both parseCalls (function→function edges) and parseSymbols
 * (functions + variables with usage edges).
 *
 * Each extractor returns Array<{ name, index }> (index = char offset in source).
 */

const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const C_EXTS = new Set(['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh']);

/** 1-based line number for a character offset in `src`. */
export function lineAt(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function functionDecls(src, ext) {
  if (JS_EXTS.has(ext)) return jsFns(src);
  switch (ext) {
    case '.py': return pyFns(src);
    case '.go': return goFns(src);
    case '.rs': return rsFns(src);
    case '.java': return cStyleFns(src);
    case '.cs': return cStyleFns(src);
    case '.rb': return rbFns(src);
    case '.php': return phpFns(src);
    default: return C_EXTS.has(ext) ? cStyleFns(src) : [];
  }
}

export function variableDecls(src, ext) {
  if (JS_EXTS.has(ext)) return jsVars(src);
  switch (ext) {
    case '.py': return pyVars(src);
    case '.go': return goVars(src);
    case '.rs': return rsVars(src);
    case '.java': return javaVars(src);
    case '.cs': return javaVars(src);
    case '.rb': return rbVars(src);
    case '.php': return phpVars(src);
    default: return C_EXTS.has(ext) ? cVars(src) : [];
  }
}

function collect(src, regexes) {
  const out = [];
  for (const re of regexes) {
    let m;
    while ((m = re.exec(src)) !== null) out.push({ name: m[1], index: m.index });
  }
  return out;
}

// ── JavaScript / TypeScript ──────────────────────────────────────────────────
function jsFns(src) {
  return collect(src, [
    /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?function[ \t]*\*?[ \t]*(\w+)/g,
    /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+(\w+)[ \t]*=[ \t]*(?:async[ \t]+)?(?:\([^)]*\)|[\w$]+)[ \t]*=>/g,
    /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+(\w+)[ \t]*=[ \t]*(?:async[ \t]+)?function/g,
    /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?class[ \t]+(\w+)/g,
  ]);
}
function jsVars(src) {
  const out = [];
  const re = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+(\w+)[ \t]*=[ \t]*([^\n;]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rhs = m[2];
    if (/^(?:async[ \t]+)?function\b/.test(rhs) || /=>/.test(rhs)) continue; // that's a function
    out.push({ name: m[1], index: m.index });
  }
  return out;
}

// ── Python ───────────────────────────────────────────────────────────────────
function pyFns(src) {
  return collect(src, [
    /^[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)/gm,
    /^[ \t]*class[ \t]+(\w+)/gm,
  ]);
}
function pyVars(src) {
  return collect(src, [/^([A-Za-z_]\w*)[ \t]*(?::[^\n=]+)?=[ \t]*[^\n=]/gm]);
}

// ── Go ───────────────────────────────────────────────────────────────────────
function goFns(src) {
  // func name(  |  func (recv T) name(
  return collect(src, [/^[ \t]*func[ \t]+(?:\([^)]*\)[ \t]*)?(\w+)[ \t]*\(/gm]);
}
function goVars(src) {
  return collect(src, [
    /^[ \t]*var[ \t]+(\w+)/gm,
    /^[ \t]*const[ \t]+(\w+)/gm,
    /^[ \t]*(\w+)[ \t]*:=/gm,
  ]);
}

// ── Rust ─────────────────────────────────────────────────────────────────────
function rsFns(src) {
  return collect(src, [
    /^[ \t]*(?:pub[ \t]+)?(?:async[ \t]+)?fn[ \t]+(\w+)/gm,
    /^[ \t]*(?:pub[ \t]+)?(?:struct|enum|trait)[ \t]+(\w+)/gm,
  ]);
}
function rsVars(src) {
  return collect(src, [
    /^[ \t]*let[ \t]+(?:mut[ \t]+)?(\w+)/gm,
    /^[ \t]*(?:pub[ \t]+)?(?:const|static)[ \t]+(?:mut[ \t]+)?(\w+)/gm,
  ]);
}

// ── Ruby ─────────────────────────────────────────────────────────────────────
function rbFns(src) {
  return collect(src, [
    /^[ \t]*def[ \t]+(?:self\.)?(\w+)/gm,
    /^[ \t]*(?:class|module)[ \t]+(\w+)/gm,
  ]);
}
function rbVars(src) {
  return collect(src, [
    /^[ \t]*@(\w+)[ \t]*=/gm,          // instance vars
    /^[ \t]*([A-Z]\w*)[ \t]*=[ \t]*[^\n=]/gm, // constants
  ]);
}

// ── PHP ──────────────────────────────────────────────────────────────────────
function phpFns(src) {
  return collect(src, [
    /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|final|abstract)[ \t]+)*function[ \t]+(\w+)/g,
    /(?:^|\n)[ \t]*(?:abstract[ \t]+|final[ \t]+)*(?:class|interface|trait)[ \t]+(\w+)/g,
  ]);
}
function phpVars(src) {
  return collect(src, [/(?:^|\n)[ \t]*\$(\w+)[ \t]*=[ \t]*[^\n;]/g]);
}

// ── C-style (Java, C#, C, C++) ───────────────────────────────────────────────
// Matches `<modifiers?> <returnType> name(<args>) {` — a definition with a body.
function cStyleFns(src) {
  const MOD = '(?:public|private|protected|internal|static|final|virtual|override|async|sealed|abstract|extern|inline|unsafe|synchronized|native)';
  const re = new RegExp(
    `(?:^|\\n)[ \\t]*(?:${MOD}[ \\t]+)*` +     // optional modifiers
    `[A-Za-z_][\\w<>:\\[\\],.\\* \\t&]*?` +    // return type (lazy)
    `[ \\t*&]+(\\w+)[ \\t]*\\([^;{)]*\\)` +    // name(args)
    `[ \\t]*(?:const[ \\t]*)?(?:throws[\\w,. \\t]+)?\\{`, // optional const/throws, then {
    'g'
  );
  const out = [];
  let m;
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'do', 'else']);
  while ((m = re.exec(src)) !== null) {
    if (!KEYWORDS.has(m[1])) out.push({ name: m[1], index: m.index });
  }
  // classes / interfaces / enums / structs
  let c;
  const classRe = /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed)[ \t]+)*(?:class|interface|enum|struct)[ \t]+(\w+)/g;
  while ((c = classRe.exec(src)) !== null) out.push({ name: c[1], index: c.index });
  return out;
}
function javaVars(src) {
  // Fields: <modifiers> type name (= … | ;). Requiring a modifier avoids matching locals/statements.
  const re = /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|final|volatile|transient|readonly|const)[ \t]+)+[\w<>\[\].]+[ \t]+(\w+)[ \t]*[=;]/g;
  return matchAll(re, src);
}
function cVars(src) {
  // Best-effort: #define constants and file-scope `type name = …;` at column 0.
  return collect(src, [
    /^[ \t]*#define[ \t]+(\w+)/gm,
    /^(?:static[ \t]+|const[ \t]+|unsigned[ \t]+|extern[ \t]+)*[A-Za-z_]\w*[ \t]+(\w+)[ \t]*=[^=]/gm,
  ]);
}

function matchAll(re, src) {
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1], index: m.index });
  return out;
}
