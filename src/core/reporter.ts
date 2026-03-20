import chalk from 'chalk';
import Table from 'cli-table3';
import { DimensionResult, ScanReport } from './types.js';
import { dimensionLabel, DIMENSIONS } from '../dimensions/index.js';

export type OutputFormat = 'terminal' | 'json';

export function report(scanReport: ScanReport, format: OutputFormat): void {
  if (format === 'json') {
    reportJson(scanReport);
  } else {
    reportTerminal(scanReport);
  }
}

// ─── JSON output ─────────────────────────────────────────────────────────────

function reportJson(r: ScanReport): void {
  const output = {
    projectRoot: r.projectRoot,
    stacks: r.stacks,
    overallScore: r.overallScore,
    overallCeiling: r.overallCeiling,
    durationMs: r.durationMs,
    dimensions: r.dimensions.map((d) => ({
      dimension: d.dimension,
      label: dimensionLabel(d.dimension),
      score: d.score,
      ceiling: d.ceiling,
      gaps: d.gaps.map(({ check, finding }) => ({
        checkId: check.id,
        checkName: check.name,
        message: finding.message,
        score: finding.score,
        maxScore: finding.maxScore,
        severity: finding.severity,
        files: finding.files,
      })),
    })),
    strengths: r.strengths.map(({ check, finding, dimension }) => ({
      dimension,
      checkId: check.id,
      checkName: check.name,
      message: finding.message,
      score: finding.score,
    })),
    weaknesses: r.weaknesses.map(({ check, finding, dimension }) => ({
      dimension,
      checkId: check.id,
      checkName: check.name,
      message: finding.message,
      score: finding.score,
      maxScore: finding.maxScore,
    })),
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ─── Terminal output ──────────────────────────────────────────────────────────

function reportTerminal(r: ScanReport): void {
  const hr = chalk.gray('─'.repeat(68));

  // Header
  console.log('');
  console.log(chalk.bold.white('  🦝  RACOON — Codebase Quality Report'));
  console.log(hr);
  console.log(chalk.gray(`  Project : ${r.projectRoot}`));
  console.log(chalk.gray(`  Stacks  : ${r.stacks.join(', ')}`));
  console.log(chalk.gray(`  Scanned : ${(r.durationMs / 1000).toFixed(1)}s`));
  console.log('');

  // Dimension table
  const table = new Table({
    head: [
      chalk.bold('Dimension'),
      chalk.bold('Score'),
      chalk.bold('Ceiling'),
      chalk.bold('Status'),
    ],
    colWidths: [22, 10, 10, 26],
    style: { head: [], border: ['gray'] },
  });

  // Sort by dimension order defined in DIMENSIONS
  const orderedDimensions = DIMENSIONS.map((meta) =>
    r.dimensions.find((d) => d.dimension === meta.dimension),
  ).filter((d): d is DimensionResult => d !== undefined);

  for (const dr of orderedDimensions) {
    table.push([
      chalk.white(dimensionLabel(dr.dimension)),
      scoreCell(dr.score),
      chalk.gray(`${dr.ceiling}/100`),
      statusCell(dr),
    ]);
  }

  console.log(table.toString());

  // Overall score bar
  console.log('');
  console.log(overallBar(r.overallScore, r.overallCeiling));
  console.log('');

  // Strengths
  if (r.strengths.length > 0) {
    console.log(chalk.bold.green('  What lifts your score'));
    for (const { finding, dimension } of r.strengths) {
      const label = dimensionLabel(dimension);
      console.log(
        `  ${chalk.green('▲')} ${chalk.gray(`[${label}]`)} ${finding.message}`,
      );
    }
    console.log('');
  }

  // Weaknesses / gaps
  if (r.weaknesses.length > 0) {
    console.log(chalk.bold.yellow('  Documented gaps — what holds you back'));
    for (const { finding, dimension } of r.weaknesses) {
      const label = dimensionLabel(dimension);
      const gap = finding.maxScore - finding.score;
      const icon = finding.severity === 'critical' ? chalk.red('✖') : chalk.yellow('▼');
      console.log(
        `  ${icon} ${chalk.gray(`[${label}]`)} ${finding.message} ${chalk.gray(`(−${gap} pts)`)}`,
      );
      if (finding.evidence && finding.evidence.length > 0) {
        const shown = finding.evidence.slice(0, 5);
        for (const e of shown) {
          const loc = chalk.cyan(`${e.file}:${e.line}`);
          const labelTag = e.label ? chalk.magenta(`[${e.label}]`) + '  ' : '';
          const weight = e.weight ?? 1;
          const dim = weight < 1; // visually de-emphasise reduced-weight items
          const code = dim ? chalk.gray(e.snippet) : chalk.white(e.snippet);
          console.log(`     ${chalk.gray('↳')} ${loc}  ${labelTag}${code}`);
        }
        if (finding.evidence.length > 5) {
          console.log(`     ${chalk.gray(`↳ +${finding.evidence.length - 5} more`)}`);
        }
      } else if (finding.files && finding.files.length > 0) {
        const shown = finding.files.slice(0, 3);
        console.log(
          `     ${chalk.gray('↳ ' + shown.join(', ') + (finding.files.length > 3 ? ` +${finding.files.length - 3} more` : ''))}`,
        );
      }
    }
    console.log('');
  }

  // Exit hint
  const gap = r.overallCeiling - r.overallScore;
  if (gap > 0) {
    console.log(
      chalk.gray(
        `  Closing identified gaps could raise your score by up to ${chalk.white(`+${gap} pts`)} → ${chalk.white(`${r.overallCeiling}/100`)}`,
      ),
    );
    console.log('');
  }

  // Delta — changes since last scan
  if (r.delta) {
    const d = r.delta;
    const ts = new Date(d.baselineTimestamp).toLocaleString();
    console.log(hr);
    console.log('');

    const scoreArrow = d.scoreDelta > 0
      ? chalk.green(`▲ +${d.scoreDelta} pts`)
      : d.scoreDelta < 0
        ? chalk.red(`▼ ${d.scoreDelta} pts`)
        : chalk.gray('no change');

    console.log(
      `  ${chalk.bold('Changes since last scan')}  ${chalk.gray(`(${ts})`)}`,
    );
    console.log(
      `  Overall: ${chalk.white(`${d.previousScore}`)} → ${chalk.white(`${r.overallScore}`)}  ${scoreArrow}`,
    );
    console.log('');

    if (d.regressions.length > 0) {
      console.log(chalk.bold.red(`  Regressions (${d.regressions.length})`));
      for (const c of d.regressions) {
        const newEvidence = c.newEvidenceCount > 0
          ? chalk.gray(`  +${c.newEvidenceCount} new location${c.newEvidenceCount > 1 ? 's' : ''}`)
          : '';
        console.log(
          `  ${chalk.red('✖')} ${chalk.gray(`[${dimensionLabel(c.dimension)}]`)}  ` +
          `${chalk.white(c.checkName.padEnd(28))}` +
          `${chalk.gray(`${c.previousScore}`)} → ${chalk.red(`${c.currentScore}`)}` +
          `  ${chalk.red(`(${c.delta})`)}${newEvidence}`,
        );
      }
      console.log('');
    }

    if (d.improvements.length > 0) {
      console.log(chalk.bold.green(`  Improvements (${d.improvements.length})`));
      for (const c of d.improvements) {
        console.log(
          `  ${chalk.green('▲')} ${chalk.gray(`[${dimensionLabel(c.dimension)}]`)}  ` +
          `${chalk.white(c.checkName.padEnd(28))}` +
          `${chalk.gray(`${c.previousScore}`)} → ${chalk.green(`${c.currentScore}`)}` +
          `  ${chalk.green(`(+${c.delta})`)}`,
        );
      }
      console.log('');
    }
  }

  console.log(hr);
  console.log('');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreCell(score: number): string {
  const formatted = `${score}/100`;
  if (score >= 80) return chalk.green(formatted);
  if (score >= 60) return chalk.yellow(formatted);
  if (score >= 40) return chalk.hex('#FFA500')(formatted);
  return chalk.red(formatted);
}

function statusCell(dr: DimensionResult): string {
  const gapCount = dr.gaps.length;
  const hasCritical = dr.gaps.some(
    (g) => g.finding.severity === 'critical',
  );

  if (dr.score >= 80 && gapCount === 0) return chalk.green('✓ Strong');
  if (dr.score >= 80) return chalk.green(`▲ Lifts score`);
  if (hasCritical) return chalk.red(`✖ Critical gaps (${gapCount})`);
  if (dr.score < 40) return chalk.red(`▼ Holds back (${gapCount} gaps)`);
  return chalk.yellow(`△ Improvable (${gapCount} gaps)`);
}

function overallBar(score: number, ceiling: number): string {
  const barWidth = 40;
  const filled = Math.round((score / 100) * barWidth);
  const ceilingPos = Math.round((ceiling / 100) * barWidth);

  const bar = Array.from({ length: barWidth }, (_, i) => {
    if (i < filled) return chalk.green('█');
    if (i === ceilingPos) return chalk.gray('◆');
    return chalk.gray('░');
  }).join('');

  const grade = scoreGrade(score);
  const scoreStr = score >= 60
    ? chalk.green.bold(`${score}/100`)
    : score >= 40
    ? chalk.yellow.bold(`${score}/100`)
    : chalk.red.bold(`${score}/100`);

  return (
    `  ${bar}  ${scoreStr}  ${chalk.gray(`ceiling: ${ceiling}/100`)}  ${grade}`
  );
}

function scoreGrade(score: number): string {
  if (score >= 90) return chalk.green.bold('A');
  if (score >= 80) return chalk.green('B');
  if (score >= 70) return chalk.yellow('C');
  if (score >= 60) return chalk.yellow('D');
  if (score >= 40) return chalk.hex('#FFA500')('E');
  return chalk.red('F');
}
