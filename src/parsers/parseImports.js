/**
 * Language-specific import extractors.
 * Returns an array of { spec, line } — the raw (unresolved) import specifier
 * and the 1-based line it appears on.
 */
import { lineAt } from './declarations.js';

export function parseImports(source, ext, filePath) {
  switch (ext) {
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
    case '.mjs':
    case '.cjs':
      return parseJS(source);
    case '.py':
      return parsePython(source);
    case '.go':
      return parseGo(source);
    case '.rs':
      return parseRust(source);
    case '.java':
      return parseJava(source);
    case '.rb':
      return parseRuby(source);
    case '.php':
      return parsePHP(source);
    case '.cs':
      return parseCSharp(source);
    case '.c':
    case '.h':
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
    case '.hh':
      return parseC(source);
    default:
      return [];
  }
}

// C / C++: #include "local.h" and #include <system.h>
function parseC(src) {
  const out = [];
  const re = /^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1], line: lineAt(src, m.index) });
  return out;
}

// ES modules: import … from '…' and require('…')
function parseJS(src) {
  const out = [];
  const esm = /(?:^|;|\n)\s*import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/gm;
  const cjs = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dyn = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [esm, cjs, dyn]) {
    let m;
    // Line is computed at the specifier itself — the match may include a leading
    // newline (esm), which would otherwise put us one line early.
    while ((m = re.exec(src)) !== null) out.push({ spec: m[1], line: lineAt(src, m.index + m[0].indexOf(m[1])) });
  }
  return out;
}

function parsePython(src) {
  const out = [];
  const re = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([\w., \t]+))/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = lineAt(src, m.index);
    if (m[1]) {
      out.push({ spec: m[1].replace(/\./g, '/'), line });
    } else {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/[ \t]+as[ \t]+/)[0].trim();
        if (name) out.push({ spec: name.replace(/\./g, '/'), line });
      }
    }
  }
  return out;
}

function parseGo(src) {
  const out = [];
  let m;
  const single = /^[ \t]*import[ \t]+"([^"]+)"/gm;
  while ((m = single.exec(src)) !== null) out.push({ spec: m[1], line: lineAt(src, m.index) });
  const block = /import[ \t]*\(([\s\S]*?)\)/g;
  while ((m = block.exec(src)) !== null) {
    const blockStart = m.index + m[0].indexOf('(') + 1;
    const inner = /"([^"]+)"/g;
    let im;
    while ((im = inner.exec(m[1])) !== null) {
      out.push({ spec: im[1], line: lineAt(src, blockStart + im.index) });
    }
  }
  return out;
}

function parseRust(src) {
  const out = [];
  const re = /(?:^|\n)\s*use\s+([\w:]+)/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1].replace(/::/g, '/'), line: lineAt(src, m.index + m[0].indexOf(m[1])) });
  return out;
}

function parseJava(src) {
  const out = [];
  const re = /^\s*import\s+([\w.]+);/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1].replace(/\./g, '/'), line: lineAt(src, m.index) });
  return out;
}

function parseRuby(src) {
  const out = [];
  const re = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1], line: lineAt(src, m.index) });
  return out;
}

function parsePHP(src) {
  const out = [];
  const re = /(?:include|require)(?:_once)?\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1], line: lineAt(src, m.index) });
  return out;
}

function parseCSharp(src) {
  const out = [];
  const re = /^\s*using\s+([\w.]+);/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[1].replace(/\./g, '/'), line: lineAt(src, m.index) });
  return out;
}
