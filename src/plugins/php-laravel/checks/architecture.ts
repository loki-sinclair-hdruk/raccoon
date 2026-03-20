import * as fs from 'fs';
import * as path from 'path';
import { Check, Dimension, EvidenceItem, Finding, ScanContext } from '../../../core/types.js';
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

// ─── Check: MVC structure adherence ──────────────────────────────────────────

export const mvcStructureCheck: Check = {
  id: 'php-laravel/mvc-structure',
  name: 'MVC Structure',
  dimension: Dimension.Architecture,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    const hasControllers = context.files.some((f) => f.match(/[Cc]ontrollers?\//));
    const hasModels      = context.files.some((f) =>
      f.match(/[Mm]odels?\//) || f.match(/app\/[A-Z][a-zA-Z]+\.php$/),
    );
    const hasViews = context.files.some((f) =>
      f.match(/resources\/views\//) || f.match(/views\/.*\.blade\.php/),
    );
    const hasRoutes = context.files.some((f) =>
      f.match(/routes\/.*\.php$/) || f === 'routes/web.php' || f === 'routes/api.php',
    );

    const present = [hasControllers, hasModels, hasViews, hasRoutes].filter(Boolean).length;
    const score = Math.round((present / 4) * 100);

    const missing: string[] = [];
    if (!hasControllers) missing.push('controllers');
    if (!hasModels)      missing.push('models');
    if (!hasViews)       missing.push('views/templates');
    if (!hasRoutes)      missing.push('route files');

    return {
      message: missing.length === 0
        ? 'Full MVC structure detected'
        : `MVC structure incomplete — missing: ${missing.join(', ')}`,
      score,
      maxScore: 100,
      severity: present < 3 ? 'warning' : 'info',
      detail: { hasControllers, hasModels, hasViews, hasRoutes },
    };
  },
};

// ─── Check: Middleware usage ──────────────────────────────────────────────────

export const middlewareCheck: Check = {
  id: 'php-laravel/middleware-usage',
  name: 'Middleware Usage',
  dimension: Dimension.Architecture,
  weight: 1,

  async run(context: ScanContext): Promise<Finding> {
    const middlewareFiles = context.files.filter((f) =>
      f.match(/[Mm]iddleware\/.*\.php$/),
    );

    const routeFiles = context.files.filter((f) => f.match(/^routes\//));
    let routesUseMiddleware = false;

    for (const file of routeFiles) {
      const content = readFile(context, file);
      if (content.includes('->middleware(') || content.includes("middleware('")) {
        routesUseMiddleware = true;
        break;
      }
    }

    const score = middlewareFiles.length > 0
      ? routesUseMiddleware ? 100 : 60
      : 30;

    return {
      message: `${middlewareFiles.length} middleware class(es) — route middleware: ${routesUseMiddleware ? 'yes' : 'not detected'}`,
      score,
      maxScore: 100,
      severity: 'info',
      detail: { middlewareFiles: middlewareFiles.length, routesUseMiddleware },
    };
  },
};

// ─── Check: Business logic outside controllers ────────────────────────────────

export const separationOfConcernsCheck: Check = {
  id: 'php-laravel/separation-of-concerns',
  name: 'Separation of Concerns',
  dimension: Dimension.Architecture,
  weight: 3,

  async run(context: ScanContext): Promise<Finding> {
    const controllerFiles = context.files.filter((f) =>
      f.match(/[Cc]ontrollers?\/.*\.php$/),
    );

    if (controllerFiles.length === 0) {
      return { message: 'No controllers found', score: 70, maxScore: 100, severity: 'info' };
    }

    const dbCallPattern = /DB::|->where\(|->create\(|->update\(|->delete\(/g;
    const evidence: EvidenceItem[] = [];
    let heavyControllers = 0;

    for (const file of controllerFiles) {
      const safe = readSanitizedFile(context, file);
      const dbCalls = (safe.match(dbCallPattern) ?? []).length;

      if (dbCalls > 10) {
        heavyControllers++;

        const origLines = readFile(context, file).split('\n');
        const safeLines = safe.split('\n');
        for (let i = 0; i < safeLines.length; i++) {
          if (/DB::|->where\(|->create\(|->update\(|->delete\(/.test(safeLines[i])) {
            evidence.push({
              file,
              line: i + 1,
              snippet: `${snip(origLines[i] ?? '')}  [${dbCalls} total DB calls in file]`,
              weight: 1.5,
              label: 'controller',
            });
            break;
          }
        }
      }
    }

    const ratio = heavyControllers / controllerFiles.length;
    const score = Math.round(Math.max(0, 100 - ratio * 150));

    return {
      message: `${heavyControllers}/${controllerFiles.length} controllers have high direct DB call density`,
      score,
      maxScore: 100,
      severity: ratio > 0.4 ? 'critical' : ratio > 0.2 ? 'warning' : 'info',
      files: evidence.map((e) => e.file),
      evidence,
    };
  },
};
