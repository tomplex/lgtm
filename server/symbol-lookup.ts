import { execSync } from 'child_process';
import * as fs from 'fs';

export interface SymbolResult {
  file: string;
  line: number;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  body: string;
  docstring: string | null;
}

const MAX_RESULTS = 10;

interface PatternGroup {
  pattern: string;
  globs: string[];
}

function buildPatterns(symbol: string): PatternGroup[] {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    // Python: def or class
    { pattern: `^\\s*(def|class)\\s+${escaped}\\b`, globs: ['*.py'] },
    // TypeScript/JS: export? function/class/interface/type/const/let
    { pattern: `^\\s*(export\\s+)?(function|class|interface|type|const|let)\\s+${escaped}\\b`, globs: ['*.ts', '*.tsx', '*.js', '*.jsx'] },
    // Arrow functions (TS/JS only): const foo = (...) => or foo = function
    { pattern: `^\\s*(export\\s+)?(const|let|var)\\s+${escaped}\\s*=`, globs: ['*.ts', '*.tsx', '*.js', '*.jsx'] },
  ];
}

interface RgMatch {
  file: string;
  line: number;
  text: string;
}

// Directories to exclude from symbol search
const EXCLUDED_DIRS = ['dist', 'build', 'node_modules', '.git', '__pycache__', '.next', 'coverage', '.superpowers'];

// Source code extensions in priority order (higher = better)
const SOURCE_PRIORITY: Record<string, number> = {
  '.py': 10, '.ts': 10, '.tsx': 10, '.js': 9, '.jsx': 9,
  '.go': 8, '.rs': 8, '.java': 8, '.rb': 8,
};

function fileTypePriority(file: string): number {
  for (const [ext, priority] of Object.entries(SOURCE_PRIORITY)) {
    if (file.endsWith(ext)) return priority;
  }
  return 0; // non-source files (md, json, etc.)
}

function runRipgrep(repoPath: string, symbol: string): RgMatch[] {
  const patternGroups = buildPatterns(symbol);
  const matches: RgMatch[] = [];
  const seen = new Set<string>();

  const excludeArgs = EXCLUDED_DIRS.flatMap(d => ['--glob', `!${d}/`]);

  for (const { pattern, globs } of patternGroups) {
    const includeArgs = globs.flatMap(g => ['--glob', g]);
    let output: string;
    try {
      output = execSync(
        `rg --json -n ${[...excludeArgs, ...includeArgs].map(a => JSON.stringify(a)).join(' ')} -e ${JSON.stringify(pattern)} -- .`,
        { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err: unknown) {
      // rg exits 1 when no matches found
      const anyErr = err as { stdout?: string };
      output = anyErr.stdout ?? '';
    }

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      let parsed: { type: string; data: { path?: { text: string }; line_number?: number; lines?: { text: string } } };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type !== 'match') continue;
      const file = parsed.data.path?.text;
      const lineNum = parsed.data.line_number;
      const text = parsed.data.lines?.text ?? '';
      if (!file || !lineNum) continue;

      const key = `${file}:${lineNum}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ file, line: lineNum, text });
    }
  }

  return matches;
}

function detectKind(lineText: string): SymbolResult['kind'] {
  // Python
  const pyMatch = lineText.match(/^\s*(def|class)\s+/);
  if (pyMatch) {
    const raw = pyMatch[1];
    if (raw === 'def') return 'function';
    if (raw === 'class') return 'class';
  }

  // TypeScript keywords
  const tsMatch = lineText.match(/^\s*(?:export\s+)?(function|class|interface|type|const|let)\s+/);
  if (tsMatch) {
    const raw = tsMatch[1];
    if (raw === 'function') return 'function';
    if (raw === 'class') return 'class';
    if (raw === 'interface') return 'interface';
    if (raw === 'type') return 'type';
    if (raw === 'const' || raw === 'let') return 'variable';
  }

  // arrow function fallback — try to figure out const/let/var
  const arrowMatch = lineText.match(/^\s*(?:export\s+)?(const|let|var)\s+/);
  if (arrowMatch) return 'variable';

  return 'variable';
}

function isPython(file: string): boolean {
  return file.endsWith('.py');
}

function extractPythonBody(lines: string[], startIndex: number): string {
  // startIndex is 0-based index into lines array
  const defLine = lines[startIndex];
  // Determine the indentation of the def/class line itself
  const defIndentMatch = defLine.match(/^(\s*)/);
  const defIndent = defIndentMatch ? defIndentMatch[1].length : 0;

  const bodyLines = [defLine];
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines — they're part of the body
    if (line.trim() === '') {
      bodyLines.push(line);
      i++;
      continue;
    }
    const lineIndentMatch = line.match(/^(\s*)/);
    const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;
    if (lineIndent <= defIndent) {
      // Back to same or lesser indentation — body ends
      // Trim trailing blank lines
      while (bodyLines.length > 1 && bodyLines[bodyLines.length - 1].trim() === '') {
        bodyLines.pop();
      }
      break;
    }
    bodyLines.push(line);
    i++;
  }
  // Trim trailing blank lines at end of file
  while (bodyLines.length > 1 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }
  return bodyLines.join('\n');
}

function extractTypeScriptBody(lines: string[], startIndex: number): string {
  const bodyLines: string[] = [];
  let depth = 0;
  let foundOpen = false;
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    bodyLines.push(line);

    for (const ch of line) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
      }
    }

    if (foundOpen && depth === 0) {
      break;
    }

    // For type aliases and single-line declarations (no braces), stop at semicolon
    if (!foundOpen && line.includes(';')) {
      break;
    }

    i++;
  }

  return bodyLines.join('\n');
}

function extractPythonDocstring(lines: string[], startIndex: number): string | null {
  // Look for a triple-quoted string on the line after the def/class
  let i = startIndex + 1;
  // Skip the def line continuation lines (with parens) if any
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return null;

  const firstLine = lines[i].trim();

  // Single-line triple-quoted docstring: """...""" or '''...'''
  const singleLine = firstLine.match(/^(?:"""(.*)"""|'''(.*)''')/);
  if (singleLine) {
    return (singleLine[1] ?? singleLine[2]).trim();
  }

  // Multi-line: starts with """ or '''
  const openMatch = firstLine.match(/^("""|''')/);
  if (!openMatch) return null;
  const quote = openMatch[1];
  const rest = firstLine.slice(3);
  const closeIdx = rest.indexOf(quote);
  if (closeIdx !== -1) {
    // closes on same line after opening
    return rest.slice(0, closeIdx).trim();
  }

  // Collects until closing quotes
  const docLines = [rest];
  i++;
  while (i < lines.length) {
    const l = lines[i].trim();
    const end = l.indexOf(quote);
    if (end !== -1) {
      docLines.push(l.slice(0, end));
      break;
    }
    docLines.push(l);
    i++;
  }
  return docLines.join(' ').trim();
}

function extractJsDocstring(lines: string[], startIndex: number): string | null {
  // Look backwards from startIndex for a /** ... */ block
  if (startIndex === 0) return null;

  let i = startIndex - 1;
  // Skip blank lines
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;

  if (!lines[i].trim().endsWith('*/')) return null;

  const endIdx = i;
  // Find opening /**
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  if (i < 0) return null;

  const docLines: string[] = [];
  for (let j = i; j <= endIdx; j++) {
    docLines.push(lines[j]);
  }

  // Strip /** */ and * prefixes
  const raw = docLines
    .map(l => l.trim())
    .map(l => {
      if (l === '/**' || l === '*/') return '';
      if (l.startsWith('/**')) return l.slice(3).replace(/\*\/$/, '').trim();
      if (l.startsWith('* ')) return l.slice(2).trim();
      if (l.startsWith('*')) return l.slice(1).trim();
      return l;
    })
    .filter(l => l.length > 0)
    .join(' ');

  return raw || null;
}

export function sortResults(results: SymbolResult[], diffFiles: Set<string>): SymbolResult[] {
  return results.slice().sort((a, b) => {
    // Diff files first
    const aInDiff = diffFiles.has(a.file) ? 0 : 1;
    const bInDiff = diffFiles.has(b.file) ? 0 : 1;
    if (aInDiff !== bInDiff) return aInDiff - bInDiff;
    // Source code files before non-source (md, json, etc.)
    const aPri = fileTypePriority(a.file);
    const bPri = fileTypePriority(b.file);
    if (aPri !== bPri) return bPri - aPri;
    return a.file.localeCompare(b.file);
  });
}

export function findSymbol(repoPath: string, symbol: string): SymbolResult[] {
  const matches = runRipgrep(repoPath, symbol);

  // Deduplicate by file+line and cap at MAX_RESULTS
  const results: SymbolResult[] = [];

  for (const match of matches) {
    if (results.length >= MAX_RESULTS) break;

    const absoluteFile = match.file.startsWith('/') ? match.file : `${repoPath}/${match.file}`;
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(absoluteFile, 'utf8');
    } catch {
      continue;
    }

    const lines = fileContent.split('\n');
    const lineIndex = match.line - 1; // convert to 0-based
    if (lineIndex < 0 || lineIndex >= lines.length) continue;

    const kind = detectKind(lines[lineIndex]);

    let body: string;
    let docstring: string | null;

    if (isPython(match.file)) {
      body = extractPythonBody(lines, lineIndex);
      docstring = extractPythonDocstring(lines, lineIndex);
    } else {
      body = extractTypeScriptBody(lines, lineIndex);
      docstring = extractJsDocstring(lines, lineIndex);
    }

    results.push({
      file: match.file.startsWith('./') ? match.file.slice(2) : match.file,
      line: match.line,
      kind,
      body,
      docstring,
    });
  }

  return results;
}
