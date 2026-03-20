import * as fs from 'fs';
import * as path from 'path';
import {
  Check,
  Dimension,
  EvidenceItem,
  Finding,
  ScanContext,
} from '../../../core/types.js';
import {
  classifyFile,
  mergePathRules,
  PHP_LARAVEL_PATH_RULES,
} from '../../../core/path-classifier.js';
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
  const trimmed = line.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed;
}

// ─── Check: N+1 query risk ────────────────────────────────────────────────────

export const nPlusOneCheck: Check = {
  id: 'php-laravel/n-plus-one',
  name: 'N+1 Query Risk',
  dimension: Dimension.Performance,
  weight: 3,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);

    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('vendor/'),
    );

    const queryPattern =
      /->(?:find|where|whereIn|first|firstOrFail|get|all|count|sum|pluck)\s*\(/;
    const dbFacadePattern = /DB::(?:table|select|statement|raw)\s*\(/;
    const relationTraversalPattern = /\$\w+->(?!\s*with\s*\()([a-zA-Z_]+)\s*(?:->|\[)/;

    const evidence: EvidenceItem[] = [];
    let weightedHits = 0;

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue; // excluded (tests, factories, seeders)

      const origLines = readFile(context, file).split('\n');
      const safeLines = readSanitizedFile(context, file).split('\n');
      if (!origLines.length) continue;

      for (let i = 0; i < safeLines.length; i++) {
        if (!safeLines[i].match(/\b(foreach|for)\s*\(/)) continue;

        const windowSafe = safeLines.slice(i + 1, i + 11);
        for (let j = 0; j < windowSafe.length; j++) {
          if (
            queryPattern.test(windowSafe[j]) ||
            dbFacadePattern.test(windowSafe[j]) ||
            relationTraversalPattern.test(windowSafe[j])
          ) {
            weightedHits += weight;
            evidence.push({
              file,
              line: i + 2 + j,
              snippet: snip(origLines[i + 1 + j] ?? ''),
              weight,
              label,
            });
            break;
          }
        }
      }
    }

    // Sort: highest-weight (most critical) first
    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const score =
      weightedHits === 0 ? 100 : Math.max(0, 100 - Math.round(weightedHits * 12));

    return {
      message:
        evidence.length === 0
          ? 'No obvious N+1 query patterns detected'
          : `${evidence.length} potential N+1 pattern(s) found (weighted impact: ${weightedHits.toFixed(1)})`,
      score,
      maxScore: 100,
      severity: weightedHits > 3 ? 'critical' : evidence.length > 0 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence,
    };
  },
};

// ─── Check: Cache usage ───────────────────────────────────────────────────────

export const cacheUsageCheck: Check = {
  id: 'php-laravel/cache-usage',
  name: 'Cache Usage',
  dimension: Dimension.Performance,
  weight: 1,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);

    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('vendor/'),
    );

    const heavyQueryPattern =
      /(?:->get\(\)|->all\(\)|->paginate\(|DB::select\(|DB::table\()/;
    const cachePattern = /Cache::|cache\(\)|Redis::|->cache\(/;

    let cacheUsageCount = 0;
    const evidence: EvidenceItem[] = [];

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const content = readFile(context, file);
      if (!content) continue;
      const safe = readSanitizedFile(context, file);

      if (cachePattern.test(safe)) {
        cacheUsageCount++;
        continue;
      }

      // No cache in this file — flag the first heavy query line as a candidate
      const origLines = content.split('\n');
      const safeLines = safe.split('\n');
      for (let i = 0; i < safeLines.length; i++) {
        if (heavyQueryPattern.test(safeLines[i])) {
          evidence.push({
            file,
            line: i + 1,
            snippet: snip(origLines[i]),
            weight,
            label,
          });
          break;
        }
      }
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const score = cacheUsageCount > 0 ? 80 : 40;
    const base =
      cacheUsageCount > 0
        ? `Cache usage found in ${cacheUsageCount} file(s)`
        : 'No cache usage detected (Cache::, cache(), Redis::)';

    return {
      message:
        evidence.length > 0
          ? `${base} — ${evidence.length} file(s) with heavy queries and no caching`
          : base,
      score,
      maxScore: 80,
      severity: cacheUsageCount === 0 && evidence.length > 0 ? 'warning' : 'info',
      files: evidence.map((e) => e.file),
      evidence,
      detail: { filesWithCache: cacheUsageCount },
    };
  },
};

// ─── Check: Eager loading ─────────────────────────────────────────────────────

export const eagerLoadingCheck: Check = {
  id: 'php-laravel/eager-loading',
  name: 'Eager Loading (with)',
  dimension: Dimension.Performance,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const rules = mergePathRules(context.config.pathRules, PHP_LARAVEL_PATH_RULES);

    const phpFiles = context.files.filter(
      (f) => f.endsWith('.php') && !f.startsWith('vendor/'),
    );

    const eagerPattern = /(?:->|::)with\s*\(/;
    const relationLinePattern =
      /\$this->(?:hasMany|hasOne|belongsTo|belongsToMany|morphTo|morphMany|hasManyThrough)\s*\(/;

    let withCount = 0;
    let relationCallCount = 0;
    const evidence: EvidenceItem[] = [];

    for (const file of phpFiles) {
      const { weight, label } = classifyFile(file, rules);
      if (weight === 0) continue;

      const origLines = readFile(context, file).split('\n');
      const safe = readSanitizedFile(context, file);
      if (!safe) continue;
      const safeLines = safe.split('\n');

      const fileWithCount =
        (safe.match(/->with\s*\(/g) ?? []).length +
        (safe.match(/::with\s*\(/g) ?? []).length;
      withCount += fileWithCount;

      const fileUsesEager = eagerPattern.test(safe);

      for (let i = 0; i < safeLines.length; i++) {
        if (relationLinePattern.test(safeLines[i])) {
          relationCallCount++;
          if (!fileUsesEager) {
            evidence.push({
              file,
              line: i + 1,
              snippet: snip(origLines[i] ?? ''),
              weight,
              label,
            });
          }
        }
      }
    }

    if (relationCallCount === 0) {
      return {
        message: 'No Eloquent relationships detected',
        score: 70,
        maxScore: 100,
        severity: 'info',
      };
    }

    evidence.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

    const score = withCount > 0 ? Math.min(100, 60 + withCount * 5) : 30;

    return {
      message: `${withCount} eager load(s) (->with()) across ${relationCallCount} relationship definition(s)`,
      score,
      maxScore: 100,
      severity: withCount === 0 && relationCallCount > 3 ? 'warning' : 'info',
      files: [...new Set(evidence.map((e) => e.file))],
      evidence: evidence.slice(0, 10),
      detail: { withCount, relationCallCount },
    };
  },
};
