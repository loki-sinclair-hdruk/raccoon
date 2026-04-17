import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Check, Dimension, EvidenceItem, Finding, ScanContext } from '../../../core/types.js';
import { classifyFile, mergePathRules, PHP_LARAVEL_PATH_RULES } from '../../../core/path-classifier.js';
import { readSanitizedFile } from '../../../core/sanitizer.js';

function readFile(context: ScanContext, rel: string): string {
  if (context.fileCache.has(rel)) return context.fileCache.get(rel)!;
  try {
    const content = fs.readFileSync(path.join(context.projectRoot, rel), 'utf8');
    context.fileCache.set(rel, content);
    return content;
  } catch {
    return '';
  }
}

function snip(line: string, maxLen = 80): string {
  const t = line.trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
}

// ─── Duplicate code helpers ───────────────────────────────────────────────────

const DUP_WINDOW = 6;   // consecutive meaningful lines per chunk
const DUP_MIN_LEN = 15; // min trimmed line length to be considered meaningful

/** Extract sliding-window hashes from a PHP file's meaningful lines. */
function extractChunks(content: string): Map<string, number> {
  const meaningful: Array<{ text: string; lineNum: number }> = [];

  content.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.length < DUP_MIN_LEN) return;
    // Skip namespace/use/include lines — they appear in every file
    if (/^(namespace\s|use\s|require|include)/.test(t)) return;
    meaningful.push({ text: t, lineNum: i + 1 });
  });

  const chunks = new Map<string, number>(); // hash -> first line number
  for (let i = 0; i <= meaningful.length - DUP_WINDOW; i++) {
    const window = meaningful.slice(i, i + DUP_WINDOW).map((l) => l.text).join('\n');
    const hash = createHash('md5').update(window).digest('hex');
    if (!chunks.has(hash)) chunks.set(hash, meaningful[i].lineNum);
  }
  return chunks;
}

// ─── Check: Controller bloat ──────────────────────────────────────────────────
// Flags individual controller *methods* whose code-line count (comments and
// Swagger/PHPDoc annotations stripped) exceeds FAT_METHOD_THRESHOLD.
// A controller can be large if it has many small, focused actions; the real
// smell is a single method doing too much — it implies business logic has
// leaked into the controller layer.

const FAT_METHOD_THRESHOLD = 30;

/**
 * Count non-blank sanitized lines inside a method body starting at startIdx.
 * Tracks brace depth to know when the method ends.
 */
function countMethodCodeLines(safeLines: string[], startIdx: number): number {
  let depth = 0;
  let codeLines = 0;
  let started = false;

  for (let i = startIdx; i < Math.min(startIdx + 300, safeLines.length); i++) {
    for (const ch of safeLines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && safeLines[i].trim().length > 0) codeLines++;
    if (started && depth === 0) break;
  }
  return codeLines;
}

export const controllerBloatCheck: Check = {
  id: 'php-laravel/controller-bloat',
  name: 'Controller Bloat',
  dimension: Dimension.Maintainability,
  weight: 3,

  async run(context: ScanContext): Promise<Finding> {
    const controllers = context.files.filter((f) =>
      f.match(/[Cc]ontrollers?\/.*\.php$/),
    );

    if (controllers.length === 0) {
      return { message: 'No controllers found', score: 70, maxScore: 100, severity: 'info' };
    }

    const evidence: EvidenceItem[] = [];
    let totalMethods = 0;

    for (const file of controllers) {
      const origLines = readFile(context, file).split('\n');
      const safeLines = readSanitizedFile(context, file).split('\n');

      for (let i = 0; i < origLines.length; i++) {
        if (!origLines[i].match(/(?:public|protected|private|static|\s)+function\s+\w+\s*\(/)) continue;

        totalMethods++;
        const codeLines = countMethodCodeLines(safeLines, i);

        if (codeLines > FAT_METHOD_THRESHOLD) {
          evidence.push({
            file,
            line: i + 1,
            snippet: `${snip(origLines[i])}  [${codeLines} code lines]`,
            weight: 1.5,
            label: 'controller',
          });
        }
      }
    }

    if (totalMethods === 0) {
      return { message: 'No controller methods found', score: 70, maxScore: 100, severity: 'info' };
    }

    evidence.sort((a, b) => {
      const aL = parseInt(a.snippet.match(/\[(\d+) code lines\]/)?.[1] ?? '0', 10);
      const bL = parseInt(b.snippet.match(/\[(\d+) code lines\]/)?.[1] ?? '0', 10);
      return bL - aL;
    });

    const ratio = evidence.length / totalMethods;
    const score = Math.round(Math.max(0, 100 - ratio * 200));

    return {
      message: evidence.length === 0
        ? `${controllers.length} controller(s) — all methods within acceptable size`
        : `${evidence.length}/${totalMethods} controller method(s) exceed ${FAT_METHOD_THRESHOLD} code lines — likely contain business logic`,
      score,
      maxScore: 100,
      severity: ratio > 0.3 ? 'critical' : ratio > 0.1 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence,
      detail: { fatMethods: evidence.length, totalMethods },
    };
  },
};

// ─── Check: Service layer presence ───────────────────────────────────────────

export const serviceLayerCheck: Check = {
  id: 'php-laravel/service-layer',
  name: 'Service Layer',
  dimension: Dimension.Maintainability,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const services = context.files.filter((f) => f.match(/[Ss]ervices?\/.*\.php$/));
    const controllers = context.files.filter((f) => f.match(/[Cc]ontrollers?\/.*\.php$/));

    if (controllers.length === 0) {
      return {
        message: 'No controllers found — cannot assess service layer ratio',
        score: 50,
        maxScore: 80,
        severity: 'info',
      };
    }

    if (services.length === 0) {
      return {
        message: 'No service layer found — business logic likely lives in controllers',
        score: 20,
        maxScore: 100,
        severity: 'critical',
      };
    }

    const ratio = services.length / controllers.length;
    const score = Math.min(100, Math.round(40 + ratio * 60));

    return {
      message: `${services.length} services for ${controllers.length} controllers`,
      score,
      maxScore: 100,
      severity: ratio < 0.3 ? 'warning' : 'info',
      detail: { serviceCount: services.length, controllerCount: controllers.length, ratio },
    };
  },
};

// ─── Check: Cyclomatic complexity (rough) ─────────────────────────────────────

export const cyclomaticComplexityCheck: Check = {
  id: 'php-laravel/cyclomatic-complexity',
  name: 'Cyclomatic Complexity',
  dimension: Dimension.Maintainability,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);
    const phpFiles = context.files.filter((f) => f.endsWith('.php'));

    if (phpFiles.length === 0) {
      return { message: 'No PHP files found', score: 50, maxScore: 100, severity: 'info' };
    }

    const decisionKeywords = /\b(if|elseif|else if|foreach|for|while|case|catch|&&|\|\||\?)\b/g;
    const evidence: EvidenceItem[] = [];
    let totalFunctions = 0;

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const content = readFile(context, file);
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const fnMatch = lines[i].match(/(?:public|protected|private|static)?\s*function\s+(\w+)\s*\(/);
        if (!fnMatch) continue;

        totalFunctions++;
        // Grab up to 100 lines of function body for complexity estimate
        const body = lines.slice(i, i + 100).join('\n');
        const complexity = (body.match(decisionKeywords) ?? []).length + 1;

        if (complexity > 10) {
          evidence.push({
            file,
            line: i + 1,
            snippet: `${snip(lines[i])}  [complexity ≈${complexity}]`,
            weight,
            label,
          });
        }
      }
    }

    if (totalFunctions === 0) {
      return { message: 'No functions found', score: 50, maxScore: 100, severity: 'info' };
    }

    evidence.sort((a, b) => {
      const aC = parseInt(a.snippet.match(/complexity ≈(\d+)/)?.[1] ?? '0', 10);
      const bC = parseInt(b.snippet.match(/complexity ≈(\d+)/)?.[1] ?? '0', 10);
      return bC - aC;
    });

    const ratio = evidence.length / totalFunctions;
    const score = Math.round(Math.max(0, 100 - ratio * 150));

    return {
      message: `${evidence.length}/${totalFunctions} functions have high cyclomatic complexity (>10)`,
      score,
      maxScore: 100,
      severity: ratio > 0.3 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence: evidence.slice(0, 10),
      detail: { highComplexity: evidence.length, totalFunctions },
    };
  },
};

// ─── Check: Duplicate code blocks ─────────────────────────────────────────────

export const duplicateCodeCheck: Check = {
  id: 'php-laravel/duplicate-code',
  name: 'Duplicate Code',
  dimension: Dimension.Maintainability,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const sourceFiles = context.files.filter(
      (f) =>
        f.endsWith('.php') &&
        !f.includes('vendor/') &&
        !f.match(/[Tt]ests?\/.*\.php$/),
    );

    if (sourceFiles.length < 2) {
      return { message: 'Not enough source files to detect duplication', score: 80, maxScore: 100, severity: 'info' };
    }

    // hash -> all occurrences across files
    const blockMap = new Map<string, Array<{ file: string; line: number }>>();

    for (const file of sourceFiles) {
      const content = readFile(context, file);
      for (const [hash, line] of extractChunks(content)) {
        if (!blockMap.has(hash)) blockMap.set(hash, []);
        blockMap.get(hash)!.push({ file, line });
      }
    }

    // Keep only blocks that appear in 2+ distinct files
    const duplicateBlocks: Array<{ occurrences: Array<{ file: string; line: number }> }> = [];
    for (const occurrences of blockMap.values()) {
      const uniqueFiles = [...new Set(occurrences.map((o) => o.file))];
      if (uniqueFiles.length < 2) continue;
      // One representative occurrence per file
      duplicateBlocks.push({
        occurrences: uniqueFiles.map((f) => occurrences.find((o) => o.file === f)!),
      });
    }

    duplicateBlocks.sort((a, b) => b.occurrences.length - a.occurrences.length);

    const affectedFiles = new Set<string>();
    for (const { occurrences } of duplicateBlocks) {
      for (const { file } of occurrences) affectedFiles.add(file);
    }

    const evidence: EvidenceItem[] = duplicateBlocks.slice(0, 10).map(({ occurrences }) => {
      const first = occurrences[0];
      const lines = readFile(context, first.file).split('\n');
      return {
        file: first.file,
        line: first.line,
        snippet: `${snip(lines[first.line - 1] ?? '')}  [duplicated in ${occurrences.length - 1} other file(s)]`,
      };
    });

    const ratio = affectedFiles.size / sourceFiles.length;
    const score = Math.round(Math.max(0, 100 - ratio * 200));

    return {
      message: duplicateBlocks.length === 0
        ? `No duplicate code blocks found across ${sourceFiles.length} source files`
        : `${duplicateBlocks.length} duplicate block(s) across ${affectedFiles.size}/${sourceFiles.length} source files`,
      score,
      maxScore: 100,
      severity: ratio > 0.3 ? 'warning' : 'info',
      files: [...affectedFiles].slice(0, 10),
      evidence,
      detail: { duplicateBlocks: duplicateBlocks.length, affectedFiles: affectedFiles.size, totalFiles: sourceFiles.length },
    };
  },
};
