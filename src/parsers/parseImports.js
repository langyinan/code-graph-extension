/**
 * Language-specific import extractors.
 * Returns an array of raw import specifier strings (unresolved).
 */
export function parseImports(source, ext, filePath) {
  switch (ext) {
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return parseJS(source);
    case '.py':
      return parsePython(source);
    case '.go':
      return parseGo(source);
    case '.rs':
      return parseRust(source);
    case '.java':
      return parseJava(source, filePath);
    case '.rb':
      return parseRuby(source);
    case '.php':
      return parsePHP(source);
    case '.cs':
      return parseCSharp(source);
    default:
      return [];
  }
}

// ES modules: import … from '…' and require('…')
function parseJS(src) {
  const results = [];
  const esm = /(?:^|;|\n)\s*import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/gm;
  const cjs = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dyn = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [esm, cjs, dyn]) {
    let m;
    while ((m = re.exec(src)) !== null) results.push(m[1]);
  }
  return results;
}

function parsePython(src) {
  const results = [];
  // from .foo import bar  |  import foo.bar  |  import a.b, c.d as e
  // NOTE: the module list uses [ \t] (not \s) so it can't run past the line.
  const re = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([\w., \t]+))/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) {
      results.push(m[1].replace(/\./g, '/')); // from <module> import …
    } else {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/[ \t]+as[ \t]+/)[0].trim(); // strip "as alias"
        if (name) results.push(name.replace(/\./g, '/'));
      }
    }
  }
  return results;
}

function parseGo(src) {
  const results = [];
  const single = /import\s+"([^"]+)"/g;
  const block = /import\s+\(([^)]+)\)/gs;
  let m;
  while ((m = single.exec(src)) !== null) results.push(m[1]);
  while ((m = block.exec(src)) !== null) {
    for (const line of m[1].split('\n')) {
      const inner = line.match(/"([^"]+)"/);
      if (inner) results.push(inner[1]);
    }
  }
  return results;
}

function parseRust(src) {
  const results = [];
  const re = /(?:^|\n)\s*use\s+([\w:]+)/gm;
  let m;
  while ((m = re.exec(src)) !== null) results.push(m[1].replace(/::/g, '/'));
  return results;
}

function parseJava(src, filePath) {
  const results = [];
  const re = /^\s*import\s+([\w.]+);/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    results.push(m[1].replace(/\./g, '/'));
  }
  return results;
}

function parseRuby(src) {
  const results = [];
  const re = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) results.push(m[1]);
  return results;
}

function parsePHP(src) {
  const results = [];
  const re = /(?:include|require)(?:_once)?\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) results.push(m[1]);
  return results;
}

function parseCSharp(src) {
  const results = [];
  const re = /^\s*using\s+([\w.]+);/gm;
  let m;
  while ((m = re.exec(src)) !== null) results.push(m[1].replace(/\./g, '/'));
  return results;
}
