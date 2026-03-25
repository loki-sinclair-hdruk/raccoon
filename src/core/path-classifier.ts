/**
 * Path classification for scan checks.
 *
 * Rules are evaluated in order — first match wins. Checks declare which rule
 * set to use, and `.raccoon.json` pathRules are prepended (highest priority).
 *
 * weight = 0   → excluded entirely (never appears in evidence or score)
 * weight < 1   → reduced impact (fractional contribution to score penalty)
 * weight = 1   → normal
 * weight > 1   → high-impact path (amplified contribution to score penalty)
 */

export interface PathRule {
  /**
   * Substring matched against the file path (forward-slash normalised).
   * e.g. "app/Http/Controllers/" or "tests/"
   */
  pattern: string;
  /**
   * Impact multiplier.
   *   0   = excluded (no evidence, no score impact)
   *   0.x = reduced weight (shown in evidence but marked down)
   *   1   = normal
   *   1.x = high-impact (contributes more to score penalty)
   */
  weight: number;
  /** Human-readable label shown in evidence output, e.g. "controller". */
  label: string;
}

export interface FileClassification {
  weight: number;
  label: string;
}

// ─── Default rule sets ────────────────────────────────────────────────────────

/**
 * Default rules for PHP/Laravel projects.
 * Rules are evaluated top-to-bottom; first match wins.
 */
export const PHP_LARAVEL_PATH_RULES: PathRule[] = [
  // ── Excluded (weight 0) ──────────────────────────────────────────────────
  { pattern: '/tests/',            weight: 0,   label: 'test file'  },
  { pattern: '/test/',             weight: 0,   label: 'test file'  },
  { pattern: '/spec/',             weight: 0,   label: 'spec file'  },
  { pattern: 'database/factories/', weight: 0,  label: 'factory'    },
  { pattern: 'database/seeders/',  weight: 0,   label: 'seeder'     },

  // ── Reduced weight ───────────────────────────────────────────────────────
  { pattern: 'database/migrations/', weight: 0.3, label: 'migration' },
  { pattern: 'app/Console/',         weight: 0.5, label: 'command'   },

  // ── High-impact (boosted) ────────────────────────────────────────────────
  { pattern: 'app/Http/Controllers/', weight: 1.5, label: 'controller' },
  { pattern: 'app/Services/',         weight: 1.5, label: 'service'    },
  { pattern: 'app/Repositories/',     weight: 1.5, label: 'repository' },
  { pattern: 'app/Jobs/',             weight: 1.2, label: 'job'        },
  { pattern: 'app/Listeners/',        weight: 1.2, label: 'listener'   },
  { pattern: 'app/Http/Middleware/',  weight: 1.2, label: 'middleware'  },
  { pattern: 'app/Models/',           weight: 1.0, label: 'model'      },
];

/**
 * Default rules for Next.js / React projects.
 */
export const NEXTJS_REACT_PATH_RULES: PathRule[] = [
  // ── Excluded ─────────────────────────────────────────────────────────────
  { pattern: '/__tests__/',    weight: 0,   label: 'test file'   },
  { pattern: '/tests/',        weight: 0,   label: 'test file'   },
  { pattern: '/test/',         weight: 0,   label: 'test file'   },
  { pattern: '.test.',         weight: 0,   label: 'test file'   },
  { pattern: '.spec.',         weight: 0,   label: 'spec file'   },
  { pattern: '/mocks/',        weight: 0,   label: 'mock'        },
  { pattern: '/fixtures/',     weight: 0,   label: 'fixture'     },

  // ── Reduced weight ───────────────────────────────────────────────────────
  { pattern: '/stories/',      weight: 0.3, label: 'story'       },
  { pattern: '.stories.',      weight: 0.3, label: 'story'       },

  // ── High-impact ──────────────────────────────────────────────────────────
  { pattern: '/pages/',        weight: 1.5, label: 'page'        },
  { pattern: '/app/',          weight: 1.5, label: 'app route'   },
  { pattern: '/api/',          weight: 1.5, label: 'API route'   },
  { pattern: '/components/',   weight: 1.2, label: 'component'   },
  { pattern: '/hooks/',        weight: 1.2, label: 'hook'        },
  { pattern: '/lib/',          weight: 1.0, label: 'library'     },
  { pattern: '/utils/',        weight: 1.0, label: 'utility'     },
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a single file path against an ordered rule list.
 * Returns weight=1 / label="source file" if no rule matches.
 *
 * @param filePath  Path relative to project root (forward-slash normalised).
 * @param rules     Ordered rule list — first match wins.
 */
export function classifyFile(filePath: string, rules: PathRule[]): FileClassification {
  // Prepend '/' so that top-level dirs like 'tests/Feature/...' match
  // patterns written as '/tests/' (i.e. the path always starts with a slash).
  const normalised = ('/' + filePath.replace(/\\/g, '/')).replace('//', '/');
  for (const rule of rules) {
    if (normalised.includes(rule.pattern)) {
      return { weight: rule.weight, label: rule.label };
    }
  }
  return { weight: 1.0, label: 'source file' };
}

/**
 * Merge user-supplied rules (from .raccoon.json) with a default set.
 * User rules are prepended so they take priority.
 */
export function mergePathRules(
  userRules: PathRule[] | undefined,
  defaults: PathRule[],
): PathRule[] {
  return userRules ? [...userRules, ...defaults] : defaults;
}
