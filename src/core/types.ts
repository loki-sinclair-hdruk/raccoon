/**
 * Core type definitions for Raccoon — the extensible codebase quality scanner.
 *
 * Data flow:
 *   Check.run() → Finding
 *   [Finding[]] → DimensionResult (via ScoringEngine)
 *   [DimensionResult[]] → ScanReport (via ScoringEngine)
 *   ScanReport → output (via Reporter)
 */

// ─── Dimensions ─────────────────────────────────────────────────────────────

export enum Dimension {
  Readability    = 'readability',
  Maintainability = 'maintainability',
  Extensibility  = 'extensibility',
  TestCoverage   = 'test_coverage',
  Security       = 'security',
  Performance    = 'performance',
  Documentation  = 'documentation',
  Architecture   = 'architecture',
}

// ─── Stacks ──────────────────────────────────────────────────────────────────

export enum Stack {
  PhpLaravel  = 'php-laravel',
  NextjsReact = 'nextjs-react',
  Generic     = 'generic',
}

// ─── Scan Context ─────────────────────────────────────────────────────────────

/** Everything a Check needs to evaluate a project. */
export interface ScanContext {
  /** Absolute path to the root of the project being scanned. */
  projectRoot: string;
  /** Detected stacks for this project. */
  stacks: Stack[];
  /** Raw file contents cache — populated lazily by checks / readSanitizedFile. */
  fileCache: Map<string, string>;
  /**
   * Sanitized file contents cache — comments and string literals replaced with
   * spaces. Populated lazily by readSanitizedFile(). Use for pattern matching;
   * use fileCache for snippet display so line numbers stay correct.
   */
  sanitizedFileCache: Map<string, string>;
  /** Resolved list of all project file paths (relative to projectRoot). */
  files: string[];
  /** Optional config loaded from .raccoon.json in the project root. */
  config: RaccoonConfig;
}

// ─── Findings ─────────────────────────────────────────────────────────────────

export type Severity = 'info' | 'warning' | 'critical';

/** A pinpointed source location with the relevant code snippet. */
export interface EvidenceItem {
  /** Relative path from project root. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The offending source line, trimmed to ≤80 chars. */
  snippet: string;
  /**
   * Path classification weight (from PathRule).
   * 0 = excluded, <1 = reduced, 1 = normal, >1 = high-impact.
   * Omitted means weight was 1 (normal).
   */
  weight?: number;
  /** Human-readable path label, e.g. "controller", "service". */
  label?: string;
}

export interface Finding {
  /** Human-readable description of what was found. */
  message: string;
  /** 0–100 score contribution for this finding. */
  score: number;
  /** Maximum possible score this check can award (contributes to ceiling). */
  maxScore: number;
  severity: Severity;
  /** File path(s) most relevant to this finding, relative to project root. */
  files?: string[];
  /** Pinpointed source locations — shown in gap output and verbose mode. */
  evidence?: EvidenceItem[];
  /** Additional structured detail for verbose/JSON output. */
  detail?: Record<string, unknown>;
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export interface Check {
  /** Unique identifier, e.g. "php-laravel/controller-bloat" */
  id: string;
  /** Human-readable name shown in output. */
  name: string;
  dimension: Dimension;
  /**
   * Relative weight of this check within its dimension.
   * All weights within a dimension are normalised, so only ratios matter.
   */
  weight: number;
  run(context: ScanContext): Promise<Finding>;
}

// ─── Plugins ─────────────────────────────────────────────────────────────────

export interface Plugin {
  /** Unique plugin identifier, e.g. "php-laravel" */
  id: string;
  /** Stacks this plugin applies to. */
  stacks: Stack[];
  checks: Check[];
}

// ─── Results ─────────────────────────────────────────────────────────────────

export interface DimensionResult {
  dimension: Dimension;
  /** Weighted 0–100 score. */
  score: number;
  /** Maximum achievable score given current project state. */
  ceiling: number;
  /** Individual findings that contributed to this result. */
  findings: Array<{ check: Check; finding: Finding }>;
  /** Findings that indicate actionable gaps (score < maxScore). */
  gaps: Array<{ check: Check; finding: Finding }>;
}

// ─── Gamification ─────────────────────────────────────────────────────────────

/** An achievement earned by this scan (or previously and still held). */
export interface EarnedAchievement {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** True if earned for the first time in this scan. */
  isNew: boolean;
}

export interface ScanReport {
  projectRoot: string;
  stacks: Stack[];
  dimensions: DimensionResult[];
  /** Weighted overall score across all dimensions. */
  overallScore: number;
  /** Weighted overall ceiling — realistic best-case if all gaps closed. */
  overallCeiling: number;
  /** Top findings that are lifting the overall score. */
  strengths: Array<{ check: Check; finding: Finding; dimension: Dimension }>;
  /** Top findings that are holding the score back. */
  weaknesses: Array<{ check: Check; finding: Finding; dimension: Dimension }>;
  durationMs: number;
  /** Populated when a .raccoon-baseline.json exists from a previous scan. */
  delta?: ScanDelta;
  /** Achievements earned by this scan. */
  achievements?: EarnedAchievement[];
}

// ─── Baseline & delta ─────────────────────────────────────────────────────────

export interface BaselineCheckEntry {
  id: string;
  score: number;
  maxScore: number;
  evidenceCount: number;
}

export interface BaselineDimensionEntry {
  dimension: Dimension;
  score: number;
  ceiling: number;
}

/** Persisted snapshot written to .raccoon-baseline.json after each scan. */
export interface BaselineData {
  version: 1;
  timestamp: string;
  overallScore: number;
  overallCeiling: number;
  dimensions: BaselineDimensionEntry[];
  checks: BaselineCheckEntry[];
  /** IDs of all achievements earned up to and including this scan. */
  earnedAchievements?: string[];
  /** Number of consecutive scans where the overall score improved. */
  consecutiveImprovements?: number;
}

/** Per-check change between the current scan and the stored baseline. */
export interface CheckDelta {
  checkId: string;
  checkName: string;
  dimension: Dimension;
  previousScore: number;
  currentScore: number;
  /** Negative = regression, positive = improvement. */
  delta: number;
  /** Net new evidence items compared to baseline (positive = more issues found). */
  newEvidenceCount: number;
}

/** Attached to ScanReport when a baseline exists. */
export interface ScanDelta {
  scoreDelta: number;
  ceilingDelta: number;
  previousScore: number;
  previousCeiling: number;
  baselineTimestamp: string;
  /** Checks whose score dropped by more than the noise threshold. */
  regressions: CheckDelta[];
  /** Checks whose score improved by more than the noise threshold. */
  improvements: CheckDelta[];
  /** Number of checks with no meaningful change. */
  unchanged: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface DimensionWeight {
  dimension: Dimension;
  weight: number;
}

export interface RaccoonConfig {
  /** Override dimension weights. Must sum to 1.0 if all provided. */
  dimensionWeights?: Partial<Record<Dimension, number>>;
  /** Check IDs to skip entirely. */
  skip?: string[];
  /** Output format when not overridden by CLI flag. */
  outputFormat?: 'terminal' | 'json';
  /**
   * Custom path classification rules, prepended to the default rule set.
   * Rules are evaluated top-to-bottom; first match wins.
   * weight 0 = excluded, <1 = reduced, 1 = normal, >1 = high-impact.
   */
  pathRules?: import('./path-classifier.js').PathRule[];
}
