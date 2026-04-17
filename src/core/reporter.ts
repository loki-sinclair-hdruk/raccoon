import chalk from 'chalk';
import Table from 'cli-table3';
import * as fs from 'fs';
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

// ─── Tier system ──────────────────────────────────────────────────────────────

const TIERS = [
  { label: 'S', min: 90, name: 'Exceptional',    color: chalk.bold.yellow    },
  { label: 'A', min: 80, name: 'Strong',          color: chalk.bold.green     },
  { label: 'B', min: 70, name: 'Solid',           color: chalk.green          },
  { label: 'C', min: 60, name: 'Developing',      color: chalk.yellow         },
  { label: 'D', min: 40, name: 'Needs Attention', color: chalk.hex('#FFA500') },
  { label: 'E', min: 0,  name: 'Critical',        color: chalk.red            },
] as const;

type Tier = typeof TIERS[number];

function getTier(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}

function nextTier(tier: Tier): Tier | null {
  const idx = TIERS.indexOf(tier);
  return idx > 0 ? TIERS[idx - 1] : null;
}

// ─── JSON output ──────────────────────────────────────────────────────────────

function reportJson(r: ScanReport): void {
  const tier = getTier(r.overallScore);
  const output = {
    projectRoot: r.projectRoot,
    stacks: r.stacks,
    overallScore: r.overallScore,
    overallCeiling: r.overallCeiling,
    tier: { label: tier.label, name: tier.name },
    durationMs: r.durationMs,
    achievements: r.achievements ?? [],
    dimensions: r.dimensions.map((d) => ({
      dimension: d.dimension,
      label: dimensionLabel(d.dimension),
      score: d.score,
      ceiling: d.ceiling,
      tier: { label: getTier(d.score).label, name: getTier(d.score).name },
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
  console.log(chalk.bold.white('  🦝  RACCOON — Codebase Quality Report'));
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
    colWidths: [22, 14, 10, 22],
    style: { head: [], border: ['gray'] },
  });

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

  // Overall score bar + tier
  console.log('');
  console.log(overallBar(r.overallScore, r.overallCeiling));
  console.log('');

  // Strengths
  if (r.strengths.length > 0) {
    console.log(chalk.bold.green('  What lifts your score'));
    for (const { finding, dimension } of r.strengths) {
      console.log(
        `  ${chalk.green('▲')} ${chalk.gray(`[${dimensionLabel(dimension)}]`)} ${finding.message}`,
      );
    }
    console.log('');
  }

  // Gaps — full report, grouped by dimension
  const dimensionsWithGaps = orderedDimensions.filter((dr) => dr.gaps.length > 0);
  if (dimensionsWithGaps.length > 0) {
    console.log(chalk.bold.yellow('  Gaps — what holds you back'));
    for (const dr of dimensionsWithGaps) {
      console.log('');
      console.log(
        `  ${chalk.bold.white(dimensionLabel(dr.dimension))}  ${chalk.gray(`(${dr.gaps.length} gap${dr.gaps.length !== 1 ? 's' : ''})`)}`,
      );
      for (const { check, finding } of dr.gaps) {
        const gap = finding.maxScore - finding.score;
        const icon = finding.severity === 'critical' ? chalk.red('✖') : chalk.yellow('▼');
        console.log(
          `  ${icon} ${chalk.white(check.name)}  ${finding.message}  ${chalk.gray(`(−${gap} pts)`)}`,
        );
        if (finding.evidence && finding.evidence.length > 0) {
          for (const e of finding.evidence) {
            const loc = chalk.cyan(`${e.file}:${e.line}`);
            const labelTag = e.label ? chalk.magenta(`[${e.label}]`) + '  ' : '';
            const faded = (e.weight ?? 1) < 1;
            const code = faded ? chalk.gray(e.snippet) : chalk.white(e.snippet);
            console.log(`     ${chalk.gray('↳')} ${loc}  ${labelTag}${code}`);
          }
        } else if (finding.files && finding.files.length > 0) {
          for (const f of finding.files) {
            console.log(`     ${chalk.gray('↳')} ${chalk.gray(f)}`);
          }
        }
      }
    }
    console.log('');
  }

  // Ceiling hint
  const gap = r.overallCeiling - r.overallScore;
  if (gap > 0) {
    console.log(
      chalk.gray(
        `  Closing identified gaps could raise your score by up to ${chalk.white(`+${gap} pts`)} → ${chalk.white(`${r.overallCeiling}/100`)}`,
      ),
    );
    console.log('');
  }

  // Achievements
  if (r.achievements && r.achievements.length > 0) {
    console.log(hr);
    console.log('');
    const newOnes = r.achievements.filter((a) => a.isNew);
    const held    = r.achievements.filter((a) => !a.isNew);

    console.log(
      `  ${chalk.bold('Achievements')}  ${chalk.gray(`(${r.achievements.length} earned)`)}`,
    );
    console.log('');

    for (const a of newOnes) {
      console.log(
        `  ${chalk.bold.yellow('★')} ${chalk.bold.yellow(a.name.padEnd(24))} ${a.icon}  ${chalk.white(a.description)}  ${chalk.bold.yellow('← new!')}`,
      );
    }
    for (const a of held) {
      console.log(
        `  ${chalk.gray('·')} ${chalk.white(a.name.padEnd(24))} ${a.icon}  ${chalk.gray(a.description)}`,
      );
    }
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

    console.log(`  ${chalk.bold('Changes since last scan')}  ${chalk.gray(`(${ts})`)}`);
    console.log(`  Overall: ${chalk.white(`${d.previousScore}`)} → ${chalk.white(`${r.overallScore}`)}  ${scoreArrow}`);
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

// ─── GitHub summary ──────────────────────────────────────────────────────────

export function writeGithubSummary(r: ScanReport, outputPath: string): void {
  const tier = getTier(r.overallScore);
  const orderedDimensions = DIMENSIONS
    .map((meta) => r.dimensions.find((d) => d.dimension === meta.dimension))
    .filter((d): d is DimensionResult => d !== undefined);

  const lines: string[] = [];

  // Header
  lines.push(`## 🦝 Raccoon — Codebase Quality Report`);
  lines.push(``);
  lines.push(
    `**Score: ${r.overallScore}/100** &nbsp;·&nbsp; **${tier.label} — ${tier.name}** &nbsp;·&nbsp; Ceiling: ${r.overallCeiling}/100 &nbsp;·&nbsp; Scanned in ${(r.durationMs / 1000).toFixed(1)}s`,
  );
  lines.push(``);

  // Dimension table
  lines.push(`### Dimension Scores`);
  lines.push(``);
  lines.push(`| Dimension | Score | Ceiling | Gaps |`);
  lines.push(`|:----------|------:|--------:|-----:|`);
  for (const dr of orderedDimensions) {
    const dimTier = getTier(dr.score);
    const gapCount = dr.gaps.length;
    const gapCell = gapCount === 0 ? '✅ None' : `⚠️ ${gapCount}`;
    lines.push(
      `| ${dimensionLabel(dr.dimension)} | **${dr.score}/100** (${dimTier.label}) | ${dr.ceiling}/100 | ${gapCell} |`,
    );
  }
  lines.push(``);

  // Strengths
  if (r.strengths.length > 0) {
    lines.push(`### ✅ What Lifts Your Score`);
    lines.push(``);
    for (const { check, finding, dimension } of r.strengths) {
      lines.push(`- **[${dimensionLabel(dimension)}] ${check.name}** — ${finding.message}`);
    }
    lines.push(``);
  }

  // Gaps — one collapsible section per dimension
  const dimensionsWithGaps = orderedDimensions.filter((dr) => dr.gaps.length > 0);
  if (dimensionsWithGaps.length > 0) {
    lines.push(`### ⚠️ Gaps`);
    lines.push(``);
    for (const dr of dimensionsWithGaps) {
      const dimTier = getTier(dr.score);
      lines.push(
        `<details><summary><strong>${dimensionLabel(dr.dimension)}</strong> — ${dr.score}/100 (${dimTier.label}) &nbsp;·&nbsp; ${dr.gaps.length} gap${dr.gaps.length !== 1 ? 's' : ''}</summary>`,
      );
      lines.push(``);
      for (const { check, finding } of dr.gaps) {
        const gap = finding.maxScore - finding.score;
        const icon = finding.severity === 'critical' ? '🔴' : '🟡';
        lines.push(`#### ${icon} ${check.name} — ${finding.message} (−${gap} pts)`);
        lines.push(``);
        if (finding.evidence && finding.evidence.length > 0) {
          lines.push(`| File | Line | Snippet |`);
          lines.push(`|------|-----:|---------|`);
          for (const e of finding.evidence) {
            const label = e.label ? ` \`[${e.label}]\`` : '';
            lines.push(`| \`${e.file}\` | ${e.line} |${label} \`${e.snippet.replace(/`/g, "'")}\` |`);
          }
          lines.push(``);
        } else if (finding.files && finding.files.length > 0) {
          for (const f of finding.files) {
            lines.push(`- \`${f}\``);
          }
          lines.push(``);
        }
      }
      lines.push(`</details>`);
      lines.push(``);
    }
  }

  // Achievements
  if (r.achievements && r.achievements.length > 0) {
    lines.push(`### 🏆 Achievements`);
    lines.push(``);
    for (const a of r.achievements) {
      const badge = a.isNew ? ' **← new!**' : '';
      lines.push(`- ${a.icon} **${a.name}** — ${a.description}${badge}`);
    }
    lines.push(``);
  }

  // Delta
  if (r.delta) {
    const d = r.delta;
    const ts = new Date(d.baselineTimestamp).toLocaleString();
    const arrow = d.scoreDelta > 0 ? `▲ +${d.scoreDelta}` : d.scoreDelta < 0 ? `▼ ${d.scoreDelta}` : 'no change';
    lines.push(`### 📈 Changes since last scan (${ts})`);
    lines.push(``);
    lines.push(`Overall: **${d.previousScore}** → **${r.overallScore}** (${arrow} pts)`);
    lines.push(``);
    if (d.regressions.length > 0) {
      lines.push(`**Regressions**`);
      for (const c of d.regressions) {
        lines.push(`- 🔴 [${dimensionLabel(c.dimension)}] **${c.checkName}** ${c.previousScore} → ${c.currentScore} (${c.delta} pts)`);
      }
      lines.push(``);
    }
    if (d.improvements.length > 0) {
      lines.push(`**Improvements**`);
      for (const c of d.improvements) {
        lines.push(`- ✅ [${dimensionLabel(c.dimension)}] **${c.checkName}** ${c.previousScore} → ${c.currentScore} (+${c.delta} pts)`);
      }
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`*Generated by [Raccoon](https://github.com/HDRUK/raccoon)*`);

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreCell(score: number): string {
  const tier = getTier(score);
  return `${tier.color(`${score}/100`)}  ${chalk.dim(tier.color(`[${tier.label}]`))}`;
}

function statusCell(dr: DimensionResult): string {
  const gapCount  = dr.gaps.length;
  const hasCritical = dr.gaps.some((g) => g.finding.severity === 'critical');

  if (dr.score >= 80 && gapCount === 0) return chalk.green('✓ Strong');
  if (dr.score >= 80) return chalk.green(`▲ Lifts score`);
  if (hasCritical)    return chalk.red(`✖ Critical gaps (${gapCount})`);
  if (dr.score < 40)  return chalk.red(`▼ Holds back (${gapCount} gaps)`);
  return chalk.yellow(`△ Improvable (${gapCount} gaps)`);
}

function overallBar(score: number, ceiling: number): string {
  const barWidth  = 40;
  const filled    = Math.round((score / 100) * barWidth);
  const ceilingPos = Math.round((ceiling / 100) * barWidth);

  const bar = Array.from({ length: barWidth }, (_, i) => {
    if (i < filled)       return chalk.green('█');
    if (i === ceilingPos) return chalk.gray('◆');
    return chalk.gray('░');
  }).join('');

  const tier     = getTier(score);
  const next     = nextTier(tier);
  const scoreStr = tier.color.bold(`${score}/100`);
  const tierStr  = tier.color(`${tier.label}  ${tier.name}`);
  const nextHint = next
    ? chalk.gray(`  ·  ${next.min - score} pts to ${chalk.white(next.label)}`)
    : chalk.gray('  ·  peak tier');

  return `  ${bar}  ${scoreStr}  ${tierStr}${nextHint}`;
}
