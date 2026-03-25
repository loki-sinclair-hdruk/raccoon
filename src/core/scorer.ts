import {
  Check,
  Dimension,
  DimensionResult,
  Finding,
  RaccoonConfig,
  ScanReport,
  Stack,
} from './types.js';
import { resolveWeights } from '../dimensions/index.js';

interface ScoreInput {
  projectRoot: string;
  stacks: Stack[];
  results: Array<{ check: Check; finding: Finding }>;
  config: RaccoonConfig;
  durationMs: number;
}

export class ScoringEngine {
  static score(input: ScoreInput): ScanReport {
    const { projectRoot, stacks, results, config, durationMs } = input;
    const weights = resolveWeights(config.dimensionWeights);

    // ── Group results by dimension ─────────────────────────────────────────
    const byDimension = new Map<
      Dimension,
      Array<{ check: Check; finding: Finding }>
    >();

    for (const r of results) {
      const d = r.check.dimension;
      if (!byDimension.has(d)) byDimension.set(d, []);
      byDimension.get(d)!.push(r);
    }

    // ── Score each dimension ───────────────────────────────────────────────
    const dimensionResults: DimensionResult[] = [];

    for (const [dimension, items] of byDimension.entries()) {
      const totalWeight = items.reduce((s, i) => s + i.check.weight, 0);

      let weightedScore = 0;
      let weightedCeiling = 0;

      for (const { check, finding } of items) {
        const normalised = totalWeight > 0 ? check.weight / totalWeight : 0;
        weightedScore   += finding.score    * normalised;
        weightedCeiling += finding.maxScore * normalised;
      }

      const score   = Math.round(Math.max(0, Math.min(100, weightedScore)));
      const ceiling = Math.round(Math.max(score, Math.min(100, weightedCeiling)));

      const gaps = items.filter(
        ({ finding }) => finding.score < finding.maxScore,
      );

      dimensionResults.push({
        dimension,
        score,
        ceiling,
        findings: items,
        gaps,
      });
    }

    // ── Overall score ──────────────────────────────────────────────────────
    let totalWeight = 0;
    let weightedScore = 0;
    let weightedCeiling = 0;

    for (const dr of dimensionResults) {
      const w = weights[dr.dimension] ?? 0;
      totalWeight     += w;
      weightedScore   += dr.score   * w;
      weightedCeiling += dr.ceiling * w;
    }

    const overallScore = totalWeight > 0
      ? Math.round(weightedScore / totalWeight)
      : 0;
    const overallCeiling = totalWeight > 0
      ? Math.round(weightedCeiling / totalWeight)
      : 0;

    // ── Strengths & weaknesses ─────────────────────────────────────────────
    // Flatten all findings, annotated with their dimension
    const allFindings = dimensionResults.flatMap((dr) =>
      dr.findings.map((f) => ({ ...f, dimension: dr.dimension })),
    );

    // Strengths: findings scoring ≥ 70 and within 10 pts of their max
    const strengths = allFindings
      .filter((f) => f.finding.score >= 70 && f.finding.score >= f.finding.maxScore * 0.75)
      .sort((a, b) => b.finding.score - a.finding.score)
      .slice(0, 5);

    // Weaknesses: biggest gap between score and maxScore
    const weaknesses = allFindings
      .filter((f) => f.finding.score < f.finding.maxScore)
      .sort(
        (a, b) =>
          (b.finding.maxScore - b.finding.score) -
          (a.finding.maxScore - a.finding.score),
      )
      .slice(0, 5);

    return {
      projectRoot,
      stacks,
      dimensions: dimensionResults,
      overallScore,
      overallCeiling,
      strengths,
      weaknesses,
      durationMs,
    };
  }
}
