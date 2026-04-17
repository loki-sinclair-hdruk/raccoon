import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Check, Dimension, EvidenceItem, Finding, ScanContext } from '../../../core/types.js';
import { classifyFile, mergePathRules, NEXTJS_REACT_PATH_RULES } from '../../../core/path-classifier.js';

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

/** Extract sliding-window hashes from a file's meaningful lines. */
function extractChunks(content: string): Map<string, number> {
  const meaningful: Array<{ text: string; lineNum: number }> = [];

  content.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.length < DUP_MIN_LEN) return;
    // Skip import / re-export lines — they appear in every file
    if (/^import\s/.test(t) && /\bfrom\b/.test(t)) return;
    if (/^export\s*\{[^}]*\}\s*from/.test(t)) return;
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

// ─── Check: TypeScript usage ──────────────────────────────────────────────────

export const typescriptCheck: Check = {
  id: 'nextjs-react/typescript',
  name: 'TypeScript Usage',
  dimension: Dimension.Maintainability,
  weight: 3,

  async run(context: ScanContext): Promise<Finding> {
    const hasTsConfig = context.files.includes('tsconfig.json');
    const tsFiles = context.files.filter(
      (f) => f.match(/\.(ts|tsx)$/) && !f.includes('node_modules'),
    );
    const jsFiles = context.files.filter(
      (f) => f.match(/\.(js|jsx)$/) && !f.includes('node_modules') && !f.match(/\.config\.(js|cjs|mjs)$/),
    );

    if (!hasTsConfig && tsFiles.length === 0) {
      return {
        message: 'No TypeScript found — JS-only project',
        score: 30,
        maxScore: 100,
        severity: 'warning',
      };
    }

    const total = tsFiles.length + jsFiles.length;
    const tsRatio = total > 0 ? tsFiles.length / total : 1;
    const score = Math.round(40 + tsRatio * 60);

    return {
      message: `${tsFiles.length} TS/TSX files, ${jsFiles.length} plain JS/JSX files (${Math.round(tsRatio * 100)}% typed)`,
      score,
      maxScore: 100,
      severity: tsRatio < 0.5 ? 'warning' : 'info',
      detail: { tsFiles: tsFiles.length, jsFiles: jsFiles.length, ratio: tsRatio },
    };
  },
};

// ─── Check: Custom hook extraction ────────────────────────────────────────────

export const customHookCheck: Check = {
  id: 'nextjs-react/custom-hooks',
  name: 'Custom Hook Extraction',
  dimension: Dimension.Maintainability,
  weight: 1,

  async run(context: ScanContext): Promise<Finding> {
    const hookFiles = context.files.filter(
      (f) => f.match(/use[A-Z][a-zA-Z]+\.(ts|tsx|js|jsx)$/) && !f.includes('node_modules'),
    );
    const componentFiles = context.files.filter(
      (f) => f.match(/\.(jsx|tsx)$/) && !f.includes('node_modules'),
    );

    if (componentFiles.length === 0) {
      return { message: 'No component files found', score: 50, maxScore: 80, severity: 'info' };
    }

    const ratio = hookFiles.length / componentFiles.length;
    const score = hookFiles.length === 0 ? 30 : Math.min(80, Math.round(40 + ratio * 80));

    return {
      message: `${hookFiles.length} custom hook file(s) for ${componentFiles.length} components`,
      score,
      maxScore: 80,
      severity: 'info',
      detail: { hookFiles: hookFiles.length, componentFiles: componentFiles.length },
    };
  },
};

// ─── Check: Prop types / TypeScript interfaces ────────────────────────────────

export const propTypesCheck: Check = {
  id: 'nextjs-react/prop-types',
  name: 'Prop Typing',
  dimension: Dimension.Maintainability,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, NEXTJS_REACT_PATH_RULES);
    const componentFiles = context.files.filter(
      (f) => f.match(/\.(jsx|tsx)$/) && !f.includes('node_modules'),
    );

    if (componentFiles.length === 0) {
      return { message: 'No component files found', score: 50, maxScore: 100, severity: 'info' };
    }

    let typedComponents = 0;
    const evidence: EvidenceItem[] = [];

    for (const file of componentFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const content = readFile(context, file);
      const lines = content.split('\n');

      const hasTypeProps =
        content.match(/(?:interface|type)\s+\w*[Pp]rops\w*\s*[={<]/) ||
        content.match(/React\.FC</) ||
        content.match(/:\s*\w+Props\b/) ||
        content.match(/PropTypes\./);

      if (hasTypeProps) {
        typedComponents++;
      } else {
        // Only flag files that actually export a component
        const exportIdx = lines.findIndex((l) =>
          l.match(/export\s+(?:default\s+)?(?:function|const)\s+[A-Z]/),
        );
        if (exportIdx >= 0) {
          evidence.push({
            file,
            line: exportIdx + 1,
            snippet: snip(lines[exportIdx]),
            weight,
            label,
          });
        }
      }
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const exportedComponents = typedComponents + evidence.length;
    if (exportedComponents === 0) {
      return { message: 'No exported components found', score: 50, maxScore: 100, severity: 'info' };
    }

    const ratio = typedComponents / exportedComponents;
    const score = Math.round(ratio * 100);

    return {
      message: `${typedComponents}/${exportedComponents} exported components have typed props`,
      score,
      maxScore: 100,
      severity: ratio < 0.5 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence: evidence.slice(0, 10),
    };
  },
};

// ─── Check: Duplicate code blocks ─────────────────────────────────────────────

export const duplicateCodeCheck: Check = {
  id: 'nextjs-react/duplicate-code',
  name: 'Duplicate Code',
  dimension: Dimension.Maintainability,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const sourceFiles = context.files.filter(
      (f) =>
        f.match(/\.(ts|tsx|js|jsx)$/) &&
        !f.includes('node_modules') &&
        !f.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) &&
        !f.match(/\.(config|stories)\.(ts|tsx|js|jsx)$/),
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
