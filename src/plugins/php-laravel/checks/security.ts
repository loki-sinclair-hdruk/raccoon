import * as fs from 'fs';
import * as path from 'path';
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

/** Replace secret values in a line with [REDACTED] for safe display. */
function redact(line: string): string {
  return line
    .replace(
      /((?:password|passwd|pwd|secret|api[_\-]?key|auth[_\-]?token)\s*=\s*)(['"])[^'"]{4,}(['"])/gi,
      '$1$2[REDACTED]$3',
    )
    .replace(
      /(define\(['"][A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z_]*['"],\s*)(['"])[^'"]{4,}(['"])/gi,
      '$1$3[REDACTED]$4',
    );
}

// ─── Check: Hardcoded secrets ─────────────────────────────────────────────────

export const hardcodedSecretsCheck: Check = {
  id: 'php-laravel/hardcoded-secrets',
  name: 'Hardcoded Secrets',
  dimension: Dimension.Security,
  weight: 4,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);
    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('vendor/'),
    );

    const secretPatterns = [
      /(['"])(?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token)\1\s*=\s*(['"])[^'"]{6,}\2/i,
      /\$_ENV\[['"][A-Z_]+['"]\]\s*=\s*['"][^'"]{6,}['"]/,
      /define\(['"][A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z_]*['"],\s*['"][^'"]{6,}['"]/,
    ];

    const evidence: EvidenceItem[] = [];

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const origLines = readFile(context, file).split('\n');
      const safeLines = readSanitizedFile(context, file).split('\n');

      for (let i = 0; i < safeLines.length; i++) {
        for (const pattern of secretPatterns) {
          if (pattern.test(safeLines[i])) {
            evidence.push({
              file,
              line: i + 1,
              snippet: snip(redact(origLines[i])),
              weight,
              label,
            });
            break;
          }
        }
      }
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const score = evidence.length === 0 ? 100 : Math.max(0, 100 - evidence.length * 25);

    return {
      message:
        evidence.length === 0
          ? 'No hardcoded secrets detected'
          : `${evidence.length} potential hardcoded secret(s) found`,
      score,
      maxScore: 100,
      severity: evidence.length > 0 ? 'critical' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence,
    };
  },
};

// ─── Check: SQL injection risk ────────────────────────────────────────────────

export const sqlInjectionCheck: Check = {
  id: 'php-laravel/sql-injection',
  name: 'SQL Injection Risk',
  dimension: Dimension.Security,
  weight: 4,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);
    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('vendor/'),
    );

    const riskyPatterns = [
      /DB::(?:statement|select|insert|update|delete)\s*\(\s*["'`][^)]*\$[a-zA-Z_]/,
      /\$(?:pdo|db|conn)\s*->\s*query\s*\(\s*["'`][^)]*\$[a-zA-Z_]/,
      /whereRaw\s*\(\s*["'`][^)]*\$[a-zA-Z_]/,
      /selectRaw\s*\(\s*["'`][^)]*\$[a-zA-Z_]/,
    ];

    const evidence: EvidenceItem[] = [];

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const origLines = readFile(context, file).split('\n');
      const safeLines = readSanitizedFile(context, file).split('\n');
      let fileHit = false;

      for (let i = 0; i < safeLines.length; i++) {
        if (fileHit) break;
        for (const pattern of riskyPatterns) {
          if (pattern.test(safeLines[i])) {
            evidence.push({ file, line: i + 1, snippet: snip(origLines[i]), weight, label });
            fileHit = true;
            break;
          }
        }
      }
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const score = evidence.length === 0 ? 100 : Math.max(0, 100 - evidence.length * 20);

    return {
      message:
        evidence.length === 0
          ? 'No raw SQL with variable interpolation detected'
          : `${evidence.length} file(s) with potential SQL injection risk`,
      score,
      maxScore: 100,
      severity: evidence.length > 0 ? 'critical' : 'info',
      files: evidence.map((e) => e.file),
      evidence,
    };
  },
};

// ─── Check: .env file exposure ────────────────────────────────────────────────

export const envExposureCheck: Check = {
  id: 'php-laravel/env-exposure',
  name: '.env Exposure',
  dimension: Dimension.Security,
  weight: 3,

  async run(context: ScanContext): Promise<Finding> {
    const issues: string[] = [];

    if (context.files.includes('.env')) {
      issues.push('.env file present in repository');
    }

    const envFiles = context.files.filter((f) =>
      f.match(/^\.env\.(prod|production|staging|live)$/),
    );
    for (const f of envFiles) {
      issues.push(`${f} found in repository`);
    }

    const gitignore = context.files.find((f) => f === '.gitignore');
    if (gitignore) {
      const content = readFile(context, gitignore);
      if (!content.includes('.env')) {
        issues.push('.gitignore does not exclude .env');
      }
    } else {
      issues.push('No .gitignore found');
    }

    const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 30);

    return {
      message: issues.length === 0 ? '.env handling looks safe' : issues.join('; '),
      score,
      maxScore: 100,
      severity: issues.some((i) => i.includes('.env file present')) ? 'critical' : 'warning',
    };
  },
};

// ─── Check: Mass assignment protection ───────────────────────────────────────

export const massAssignmentCheck: Check = {
  id: 'php-laravel/mass-assignment',
  name: 'Mass Assignment Protection',
  dimension: Dimension.Security,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const models = context.files.filter(
      (f) => f.match(/[Mm]odels?\/.*\.php$/) || f.match(/app\/.*(?<!Test)\.php$/),
    );

    if (models.length === 0) {
      return { message: 'No model files found', score: 70, maxScore: 100, severity: 'info' };
    }

    let guardedCount = 0;
    let fillableCount = 0;
    const evidence: EvidenceItem[] = [];

    for (const file of models) {
      const content = readFile(context, file);

      if (!content.includes('extends Model') && !content.includes('extends Authenticatable')) {
        continue;
      }

      const hasGuarded  = content.includes('$guarded');
      const hasFillable = content.includes('$fillable');

      if (hasGuarded) {
        guardedCount++;
      } else if (hasFillable) {
        fillableCount++;
      } else {
        // Find the class declaration line as the anchor
        const lines = content.split('\n');
        const classLineIdx = lines.findIndex((l) => l.match(/class\s+\w+.*extends\s+(?:Model|Authenticatable)/));
        const anchorIdx = classLineIdx >= 0 ? classLineIdx : 0;
        evidence.push({
          file,
          line: anchorIdx + 1,
          snippet: snip(lines[anchorIdx]),
          weight: 1.0,
          label: 'model',
        });
      }
    }

    const totalModels = guardedCount + fillableCount + evidence.length;
    if (totalModels === 0) {
      return { message: 'No Eloquent models found', score: 70, maxScore: 100, severity: 'info' };
    }

    const score = Math.round(Math.max(0, 100 - (evidence.length / totalModels) * 100));

    return {
      message: `${evidence.length}/${totalModels} models lack $fillable/$guarded`,
      score,
      maxScore: 100,
      severity: evidence.length > 0 ? 'warning' : 'info',
      files: evidence.map((e) => e.file),
      evidence,
    };
  },
};
