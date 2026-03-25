#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { Scanner } from '../core/scanner.js';
import { report, OutputFormat } from '../core/reporter.js';
import { RaccoonConfig, Stack } from '../core/types.js';

// ── Register plugins (side-effect imports) ────────────────────────────────────
import '../plugins/php-laravel/index.js';
import '../plugins/nextjs-react/index.js';

// ─────────────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('raccoon')
  .description('Extensible codebase quality scanner — scores projects across 8 engineering dimensions')
  .version('0.1.0');

program
  .command('scan [directory]', { isDefault: true })
  .description('Scan a project directory and report quality scores')
  .option('-f, --format <format>', 'Output format: terminal or json', 'terminal')
  .option('-v, --verbose', 'Verbose output during scan', false)
  .option('--stack <stacks>', 'Force specific stacks (comma-separated): php-laravel,nextjs-react')
  .option('--skip <checks>', 'Comma-separated check IDs to skip')
  .option('--fail-under <score>', 'Exit with code 1 if overall score is below this threshold')
  .action(async (directory: string | undefined, opts) => {
    const projectRoot = path.resolve(directory ?? '.');

    if (!fs.existsSync(projectRoot)) {
      console.error(`Error: directory not found — ${projectRoot}`);
      process.exit(1);
    }

    // Load .raccoon.json config if present
    let fileConfig: RaccoonConfig = {};
    const configPath = path.join(projectRoot, '.raccoon.json');
    if (fs.existsSync(configPath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RaccoonConfig;
      } catch {
        console.error(`Warning: could not parse .raccoon.json — using defaults`);
      }
    }

    // CLI options take precedence over file config
    const config: RaccoonConfig = {
      ...fileConfig,
      outputFormat: (opts.format as OutputFormat) ?? fileConfig.outputFormat ?? 'terminal',
      skip: [
        ...(fileConfig.skip ?? []),
        ...(opts.skip ? (opts.skip as string).split(',').map((s: string) => s.trim()) : []),
      ],
    };

    const forceStacks = opts.stack
      ? (opts.stack as string).split(',').map((s: string) => s.trim() as Stack)
      : undefined;

    const scanner = new Scanner({
      projectRoot,
      config,
      forceStacks,
      verbose: opts.verbose as boolean,
    });

    try {
      const result = await scanner.scan();
      report(result, config.outputFormat as OutputFormat ?? 'terminal');

      // CI/CD exit code support
      if (opts.failUnder !== undefined) {
        const threshold = parseInt(opts.failUnder as string, 10);
        if (isNaN(threshold) || threshold < 0 || threshold > 100) {
          console.error(`Error: --fail-under must be a number between 0 and 100`);
          process.exit(1);
        }
        if (result.overallScore < threshold) {
          console.error(`Quality gate failed: score ${result.overallScore} is below threshold ${threshold}`);
          process.exit(1);
        }
      }
    } catch (err) {
      console.error(`Scan failed: ${String(err)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
