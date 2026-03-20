import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { Check, RacoonConfig, ScanContext, Stack } from './types.js';
import { PluginRegistry } from './registry.js';
import { detectStacks } from './detector.js';
import { ScoringEngine } from './scorer.js';
import { ScanReport } from './types.js';
import { loadBaseline, saveBaseline, computeDelta } from './baseline.js';

export interface ScanOptions {
  projectRoot: string;
  config?: RacoonConfig;
  /** Restrict to specific stacks instead of auto-detecting. */
  forceStacks?: Stack[];
  /** Verbose logging to stderr during scan. */
  verbose?: boolean;
}

export class Scanner {
  constructor(private options: ScanOptions) {}

  async scan(): Promise<ScanReport> {
    const start = Date.now();
    const { projectRoot, config = {}, forceStacks, verbose } = this.options;

    const absRoot = path.resolve(projectRoot);
    if (!fs.existsSync(absRoot)) {
      throw new Error(`Project root not found: ${absRoot}`);
    }

    // 1. Detect stacks
    const { stacks, evidence } = detectStacks(absRoot);
    const activeStacks = forceStacks ?? stacks;

    if (verbose) {
      console.error(`[racoon] Detected stacks: ${activeStacks.join(', ')}`);
      for (const stack of activeStacks) {
        console.error(`[racoon]   ${stack}: ${evidence[stack].join(', ')}`);
      }
    }

    // 2. Resolve applicable checks from registry
    const checks = PluginRegistry.checksFor(activeStacks).filter(
      (c) => !config.skip?.includes(c.id),
    );

    if (verbose) {
      console.error(`[racoon] Running ${checks.length} checks...`);
    }

    // 3. Build scan context
    const context = await this.buildContext(absRoot, activeStacks, config);

    // 4. Run all checks (in parallel, grouped by dimension for progress UX)
    const results = await this.runChecks(checks, context, verbose);

    // 5. Score
    const report = ScoringEngine.score({
      projectRoot: absRoot,
      stacks: activeStacks,
      results,
      config,
      durationMs: Date.now() - start,
    });

    // 6. Baseline delta — load previous snapshot, compute diff, save new one
    const baseline = loadBaseline(absRoot);
    if (baseline) {
      report.delta = computeDelta(report, baseline);
    }
    saveBaseline(absRoot, report);

    return report;
  }

  private async buildContext(
    projectRoot: string,
    stacks: Stack[],
    config: RacoonConfig,
  ): Promise<ScanContext> {
    // Enumerate all files, excluding common noise dirs
    const patterns = ['**/*'];
    const ignore = [
      '**/node_modules/**',
      '**/vendor/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.lock',
      '**/*.min.js',
      '**/*.min.css',
    ];

    const files = await glob(patterns, {
      cwd: projectRoot,
      ignore,
      nodir: true,
    });

    return {
      projectRoot,
      stacks,
      fileCache: new Map(),
      sanitizedFileCache: new Map(),
      files,
      config,
    };
  }

  private async runChecks(
    checks: Check[],
    context: ScanContext,
    verbose?: boolean,
  ): Promise<Array<{ check: Check; finding: Awaited<ReturnType<Check['run']>> }>> {
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          const finding = await check.run(context);
          if (verbose) {
            console.error(
              `[racoon]   ✓ ${check.id} → ${finding.score}/${finding.maxScore}`,
            );
          }
          return { check, finding };
        } catch (err) {
          if (verbose) {
            console.error(`[racoon]   ✗ ${check.id} threw: ${String(err)}`);
          }
          // Failed check doesn't crash the scan — it scores 0
          return {
            check,
            finding: {
              message: `Check failed: ${String(err)}`,
              score: 0,
              maxScore: 100,
              severity: 'warning' as const,
            },
          };
        }
      }),
    );
    return results;
  }
}
