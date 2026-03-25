/**
 * Baseline tracking — persists a scan result snapshot to .raccoon-baseline.json
 * so subsequent scans can report regressions and improvements.
 *
 * The baseline file lives in the scanned project root (not Raccoon's own dir),
 * so teams can optionally commit it to track score trends over time, or add it
 * to .gitignore to keep it local.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BaselineCheckEntry,
  BaselineData,
  CheckDelta,
  Dimension,
  ScanDelta,
  ScanReport,
} from './types.js';

const BASELINE_FILE = '.raccoon-baseline.json';

/** Minimum score change required to count as a regression or improvement. */
const NOISE_THRESHOLD = 3;

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function loadBaseline(projectRoot: string): BaselineData | null {
  const filePath = path.join(projectRoot, BASELINE_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as BaselineData;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null; // no baseline yet — first scan
  }
}

export function saveBaseline(
  projectRoot: string,
  report: ScanReport,
  consecutiveImprovements = 0,
): void {
  const data: BaselineData = {
    version: 1,
    timestamp: new Date().toISOString(),
    overallScore: report.overallScore,
    overallCeiling: report.overallCeiling,
    dimensions: report.dimensions.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      ceiling: d.ceiling,
    })),
    checks: report.dimensions.flatMap((d) =>
      d.findings.map(({ check, finding }) => ({
        id: check.id,
        score: finding.score,
        maxScore: finding.maxScore,
        evidenceCount: finding.evidence?.length ?? 0,
      })),
    ),
    earnedAchievements: report.achievements?.map((a) => a.id) ?? [],
    consecutiveImprovements,
  };

  const filePath = path.join(projectRoot, BASELINE_FILE);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Non-fatal: baseline just won't be written (e.g. read-only FS)
  }
}

// ─── Delta computation ────────────────────────────────────────────────────────

export function computeDelta(report: ScanReport, baseline: BaselineData): ScanDelta {
  const checkMap = new Map<string, BaselineCheckEntry>(
    baseline.checks.map((c) => [c.id, c]),
  );

  const regressions: CheckDelta[] = [];
  const improvements: CheckDelta[] = [];
  let unchanged = 0;

  for (const dim of report.dimensions) {
    for (const { check, finding } of dim.findings) {
      const prev = checkMap.get(check.id);
      if (!prev) continue; // new check not in baseline — skip

      const delta = finding.score - prev.score;
      const newEvidenceCount = Math.max(
        0,
        (finding.evidence?.length ?? 0) - prev.evidenceCount,
      );

      const entry: CheckDelta = {
        checkId: check.id,
        checkName: check.name,
        dimension: dim.dimension as Dimension,
        previousScore: prev.score,
        currentScore: finding.score,
        delta,
        newEvidenceCount,
      };

      if (delta <= -NOISE_THRESHOLD) {
        regressions.push(entry);
      } else if (delta >= NOISE_THRESHOLD) {
        improvements.push(entry);
      } else {
        unchanged++;
      }
    }
  }

  // Worst regressions first, best improvements first
  regressions.sort((a, b) => a.delta - b.delta);
  improvements.sort((a, b) => b.delta - a.delta);

  return {
    scoreDelta: report.overallScore - baseline.overallScore,
    ceilingDelta: report.overallCeiling - baseline.overallCeiling,
    previousScore: baseline.overallScore,
    previousCeiling: baseline.overallCeiling,
    baselineTimestamp: baseline.timestamp,
    regressions,
    improvements,
    unchanged,
  };
}
