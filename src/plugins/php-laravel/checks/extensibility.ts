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

// ─── Check: Interface / contract usage ────────────────────────────────────────

export const interfaceUsageCheck: Check = {
  id: 'php-laravel/interface-usage',
  name: 'Interface / Contract Usage',
  dimension: Dimension.Extensibility,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const phpFiles = context.files.filter((f) => f.endsWith('.php'));

    let interfaceCount = 0;
    let classCount = 0;
    let implementsCount = 0;

    for (const file of phpFiles) {
      const content = readFile(context, file);
      interfaceCount  += (content.match(/^interface\s+/gm) ?? []).length;
      classCount      += (content.match(/^class\s+/gm) ?? []).length;
      implementsCount += (content.match(/\bimplements\b/g) ?? []).length;
    }

    if (classCount === 0) {
      return { message: 'No classes found', score: 50, maxScore: 100, severity: 'info' };
    }

    const score =
      interfaceCount === 0
        ? 20
        : Math.min(100, Math.round(40 + (implementsCount / classCount) * 60 + interfaceCount * 2));

    return {
      message: `${interfaceCount} interfaces, ${implementsCount}/${classCount} classes implement one`,
      score,
      maxScore: 100,
      severity: interfaceCount === 0 ? 'warning' : 'info',
      detail: { interfaceCount, classCount, implementsCount },
    };
  },
};

// ─── Check: Repository / pattern usage ───────────────────────────────────────

export const repositoryPatternCheck: Check = {
  id: 'php-laravel/repository-pattern',
  name: 'Repository Pattern',
  dimension: Dimension.Extensibility,
  weight: 1,

  async run(context: ScanContext): Promise<Finding> {
    const repos = context.files.filter((f) =>
      f.match(/[Rr]epositories?\/.*\.php$/) || f.match(/Repository\.php$/),
    );

    if (repos.length === 0) {
      return {
        message: 'No repository pattern detected — data access likely coupled to controllers/services',
        score: 40,
        maxScore: 80,
        severity: 'info',
      };
    }

    return {
      message: `${repos.length} repository class(es) found`,
      score: 80,
      maxScore: 80,
      severity: 'info',
      detail: { repoCount: repos.length },
    };
  },
};

// ─── Check: Config over hard-coding ──────────────────────────────────────────

export const configUsageCheck: Check = {
  id: 'php-laravel/config-usage',
  name: 'Config Over Hard-Coding',
  dimension: Dimension.Extensibility,
  weight: 1,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);
    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('config/'),
    );

    const urlPattern = /['"]https?:\/\/[^'"]{8,}['"]/;
    const ipPattern  = /['"]\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}['"]/;

    let hardCodedUrls = 0;
    let hardCodedIps  = 0;
    const evidence: EvidenceItem[] = [];

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const origLines = readFile(context, file).split('\n');
      const safeLines = readSanitizedFile(context, file).split('\n');

      for (let i = 0; i < safeLines.length; i++) {
        const hasUrl = urlPattern.test(safeLines[i]);
        const hasIp  = ipPattern.test(safeLines[i]);

        if (hasUrl || hasIp) {
          if (hasUrl) hardCodedUrls++;
          if (hasIp)  hardCodedIps++;
          evidence.push({ file, line: i + 1, snippet: snip(origLines[i] ?? ''), weight, label });
        }
      }
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const total = hardCodedUrls + hardCodedIps;
    const score = Math.round(Math.max(0, 100 - total * 5));

    return {
      message: `${total} hard-coded URL/IP literal(s) found outside config/`,
      score,
      maxScore: 100,
      severity: total > 5 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence: evidence.slice(0, 10),
      detail: { hardCodedUrls, hardCodedIps },
    };
  },
};
