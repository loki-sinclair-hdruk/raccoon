# 🦝 Racoon

**Extensible codebase quality scanner.** Scores projects across 8 engineering dimensions and tells you exactly what lifts your score and what holds it back.

```
  🦝  RACOON — Codebase Quality Report
  ────────────────────────────────────────────────────────────────────
  Project : /home/dev/my-api
  Stacks  : php-laravel
  Scanned : 2.4s

  ┌──────────────────────┬──────────────────┬──────────┬───────────────────────┐
  │ Dimension            │ Score            │ Ceiling  │ Status                │
  ├──────────────────────┼──────────────────┼──────────┼───────────────────────┤
  │ Security             │ 92/100  [S]      │ 95/100   │ ✓ Strong              │
  │ Readability          │ 78/100  [B]      │ 90/100   │ △ Improvable (2 gaps) │
  │ Maintainability      │ 62/100  [C]      │ 85/100   │ △ Improvable (3 gaps) │
  │ Test Coverage        │ 45/100  [D]      │ 80/100   │ ✖ Critical gaps (2)   │
  │ Extensibility        │ 70/100  [B]      │ 80/100   │ △ Improvable (1 gap)  │
  │ Performance          │ 55/100  [D]      │ 75/100   │ ▼ Holds back (3 gaps) │
  │ Documentation        │ 80/100  [A]      │ 90/100   │ ▲ Lifts score         │
  │ Architecture         │ 88/100  [A]      │ 92/100   │ ▲ Lifts score         │
  └──────────────────────┴──────────────────┴──────────┴───────────────────────┘

  ████████████████████████░░░░░░░░░░░░░◆  71/100  B  Solid  ·  9 pts to A

  What lifts your score
  ▲ [Security] No hardcoded secrets detected
  ▲ [Architecture] MVC structure in place — controllers, models, routes present
  ▲ [Documentation] README.md present with key sections

  Documented gaps — what holds you back
  ✖ [Test Coverage] 3/28 critical-path files have a corresponding test (−80 pts)
     ↳ app/Http/Controllers/Api/UserController.php:1  [controller]  class UserController
     ↳ app/Services/PaymentService.php:1             [service]     class PaymentService
     ↳ app/Jobs/SendInvoiceJob.php:1                 [job]         class SendInvoiceJob
     ↳ +14 more
  ▼ [Performance] 8 potential N+1 patterns found (weighted impact: 12.4) (−60 pts)
     ↳ app/Http/Controllers/Api/OrderController.php:87  [controller]  foreach ($orders as $order) {
     ↳ app/Jobs/SyncProductsJob.php:44                  [job]         $product->variants()->get();
  ▼ [Maintainability] 4/11 controllers exceed 300 code lines (avg 340) (−30 pts)
     ↳ app/Http/Controllers/Api/ReportController.php:1  [controller]  class ReportController [348 lines]

  Closing identified gaps could raise your score by up to +19 pts → 90/100

  ────────────────────────────────────────────────────────────────────

  Achievements  (3 earned)

  ★ Security Champion        🛡  Security dimension scored 90+        ← new!
  · Solid Architecture       🏛  Architecture scored 80+
  · No Critical Gaps         🔒  Zero critical-severity findings

  ────────────────────────────────────────────────────────────────────

  Changes since last scan  (19/03/2026, 14:22:11)
  Overall: 65 → 71  ▲ +6 pts

  Improvements (3)
  ▲ [Security]         Hardcoded Secrets           0 → 100  (+100)
  ▲ [Architecture]     Separation of Concerns      50 → 80  (+30)
  ▲ [Documentation]    README Coverage             60 → 80  (+20)

  Regressions (1)
  ✖ [Performance]      N+1 Query Patterns          80 → 40  (−40)  +3 new locations

  ────────────────────────────────────────────────────────────────────
```

---

## Dimensions

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Readability | 10% | How easy the code is to read at a glance |
| Maintainability | 15% | How safely the code can be changed and debugged |
| Extensibility | 10% | How well the codebase accommodates new features |
| Test Coverage | 15% | Breadth and quality of automated tests |
| Security | 20% | Resistance to common vulnerabilities and secret exposure |
| Performance | 10% | Code patterns that influence runtime efficiency |
| Documentation | 10% | READMEs, inline docs, and developer-facing guidance |
| Architecture | 10% | Separation of concerns, layering, and conventions |

Weights are configurable per-project via `.racoon.json`.

---

## Supported stacks (MVP)

| Stack | Detection |
|-------|-----------|
| **PHP / Laravel** | `composer.json`, `artisan`, `app/Http/Controllers/` |
| **Next.js / React** | `package.json → next + react`, `next.config.*` |

Stacks are auto-detected. Multiple stacks may be active simultaneously (e.g. a monorepo).

---

## Installation

```bash
# Clone and build
git clone https://github.com/your-org/racoon.git
cd racoon
npm install
npm run build

# Run globally (optional)
npm link
```

> **Requirements:** Node.js 18+

---

## Usage

### Basic scan

```bash
racoon scan ./path/to/project
```

### Force a specific stack

```bash
racoon scan ./my-api --stack php-laravel
racoon scan ./my-frontend --stack nextjs-react

# Multiple stacks (monorepo)
racoon scan . --stack php-laravel,nextjs-react
```

### JSON output (for CI/CD)

```bash
racoon scan ./my-project --format json
racoon scan ./my-project --format json | jq '.overallScore'
```

### Fail under a threshold (CI/CD exit code)

```bash
racoon scan ./my-project --fail-under 70
# exits with code 1 if overall score < 70
```

### Skip specific checks

```bash
racoon scan ./my-project --skip php-laravel/n-plus-one,php-laravel/cache-usage
```

### Verbose mode

```bash
racoon scan ./my-project --verbose
```

---

## GitHub Actions

```yaml
- name: Scan codebase quality
  run: |
    npx racoon scan . --format json --fail-under 60
```

Or capture the full report as an artifact:

```yaml
- name: Racoon quality scan
  run: npx racoon scan . --format json > racoon-report.json

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: racoon-report
    path: racoon-report.json
```

---

## Per-project configuration

Place a `.racoon.json` file in the root of the project being scanned:

```json
{
  "dimensionWeights": {
    "security": 0.30,
    "test_coverage": 0.20,
    "readability": 0.10,
    "maintainability": 0.10,
    "extensibility": 0.10,
    "performance": 0.10,
    "documentation": 0.05,
    "architecture": 0.05
  },
  "skip": [
    "php-laravel/changelog",
    "nextjs-react/storybook"
  ],
  "outputFormat": "terminal"
}
```

---

## Baseline tracking

After each scan, Racoon writes a `.racoon-baseline.json` snapshot to the scanned project root. On subsequent scans, it diffs the new results against this snapshot and appends a delta section to the report showing regressions and improvements per check.

Changes smaller than ±3 points are treated as noise and suppressed.

The baseline also tracks your consecutive improvement streak, which feeds into streak-based achievements.

Commit `.racoon-baseline.json` to track score trends over time, or add it to `.gitignore` to keep it local.

---

## Achievements

Racoon awards achievements as you improve your codebase. They're shown at the end of each scan, with newly unlocked ones highlighted. Earned achievements persist in `.racoon-baseline.json`.

| Achievement | Condition |
|-------------|-----------|
| Security Champion | Security dimension scored 90+ |
| Test Enthusiast | Test Coverage scored 80+ |
| Well Documented | Documentation scored 80+ |
| Solid Architecture | Architecture scored 80+ |
| Perfectionist | Any single dimension scored 100 |
| Clean Sweep | All dimensions scored 70+ |
| No Critical Gaps | Zero critical-severity findings |
| S-Tier Codebase | Overall score reached 90+ |
| Regression Free | No regressions since last scan |
| Most Improved | Score improved 10+ points in one scan |
| On a Roll | 3 consecutive scans with improvement |

---

## Checks reference

### PHP / Laravel (25 checks)

| Dimension | Check ID | What it looks for |
|-----------|----------|-------------------|
| Readability | `php-laravel/method-length` | Methods exceeding 30 lines |
| Readability | `php-laravel/naming-conventions` | PascalCase classes, camelCase methods |
| Maintainability | `php-laravel/controller-bloat` | Controllers exceeding 300 code lines (comments and annotations stripped) — signals business logic in the controller layer |
| Maintainability | `php-laravel/service-layer` | Service classes relative to controllers |
| Maintainability | `php-laravel/cyclomatic-complexity` | Decision points per function (proxy) |
| Extensibility | `php-laravel/interface-usage` | Interface / contract definitions |
| Extensibility | `php-laravel/repository-pattern` | Repository classes |
| Extensibility | `php-laravel/config-usage` | Hard-coded URLs and IPs outside `config/` |
| Test Coverage | `php-laravel/test-framework` | PHPUnit or Pest presence |
| Test Coverage | `php-laravel/test-file-ratio` | Critical-path files (controllers, services, jobs, etc.) with a corresponding test |
| Test Coverage | `php-laravel/assertion-density` | Average assertions per test file — flags placeholder/smoke tests |
| Test Coverage | `php-laravel/test-type-balance` | Feature vs Unit test mix |
| Security | `php-laravel/hardcoded-secrets` | Password/key/token literals in source |
| Security | `php-laravel/sql-injection` | Raw SQL with variable interpolation |
| Security | `php-laravel/env-exposure` | `.env` committed or unguarded in `.gitignore` |
| Security | `php-laravel/mass-assignment` | Eloquent models without `$fillable`/`$guarded` |
| Performance | `php-laravel/n-plus-one` | Query calls inside loops (test files excluded) |
| Performance | `php-laravel/cache-usage` | `Cache::` / `Redis::` usage |
| Performance | `php-laravel/eager-loading` | `->with()` vs relationship definition ratio |
| Documentation | `php-laravel/readme` | README presence and key sections |
| Documentation | `php-laravel/phpdoc-coverage` | PHPDoc blocks on public methods |
| Documentation | `php-laravel/changelog` | CHANGELOG presence |
| Architecture | `php-laravel/mvc-structure` | Controllers, models, views, routes all present |
| Architecture | `php-laravel/middleware-usage` | Middleware classes and route usage |
| Architecture | `php-laravel/separation-of-concerns` | Direct DB call density in controllers |

### Next.js / React (25 checks)

| Dimension | Check ID | What it looks for |
|-----------|----------|-------------------|
| Readability | `nextjs-react/eslint-config` | ESLint config with optional strict preset |
| Readability | `nextjs-react/component-size` | Components exceeding 200 lines |
| Maintainability | `nextjs-react/typescript` | TS/TSX vs JS/JSX file ratio |
| Maintainability | `nextjs-react/custom-hooks` | Custom hook files relative to components |
| Maintainability | `nextjs-react/prop-types` | Exported components with typed props |
| Extensibility | `nextjs-react/file-structure` | Conventional dirs (features/, hooks/, types/, utils/) |
| Extensibility | `nextjs-react/env-var-usage` | `.env.example`, `.gitignore` coverage |
| Extensibility | `nextjs-react/api-abstraction` | API layer files vs raw fetch in components |
| Test Coverage | `nextjs-react/test-framework` | Jest/Vitest/Cypress/Playwright presence |
| Test Coverage | `nextjs-react/test-file-ratio` | Critical-path files (pages, app routes, components, hooks) with a corresponding test |
| Test Coverage | `nextjs-react/assertion-density` | Average assertions per test file — flags placeholder/smoke tests |
| Test Coverage | `nextjs-react/coverage-config` | Coverage script + threshold enforcement |
| Security | `nextjs-react/xss-risk` | `dangerouslySetInnerHTML` usage |
| Security | `nextjs-react/eval-usage` | `eval()` / `new Function()` calls |
| Security | `nextjs-react/hardcoded-secrets` | API key / token literals |
| Security | `nextjs-react/security-headers` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy in `next.config` — missing headers are listed with a description of what each one protects |
| Performance | `nextjs-react/next-image` | `next/image` vs raw `<img>` ratio |
| Performance | `nextjs-react/code-splitting` | Dynamic imports and `React.lazy()` |
| Performance | `nextjs-react/memoization` | `React.memo`, `useMemo`, `useCallback` usage |
| Documentation | `nextjs-react/readme` | README presence and key sections |
| Documentation | `nextjs-react/jsdoc-coverage` | JSDoc on exported functions |
| Documentation | `nextjs-react/storybook` | `.storybook/` config and story files |
| Architecture | `nextjs-react/router-consistency` | App Router vs Pages Router (no mixing) |
| Architecture | `nextjs-react/api-routes` | API route file size |
| Architecture | `nextjs-react/server-client-separation` | `"use client"` / `"use server"` discipline |

---

## Extending Racoon

Adding support for a new stack (e.g. Django, Ruby on Rails) takes three steps:

### 1. Create your checks

```
src/plugins/django/checks/
  readability.ts
  security.ts
  ...
```

Each check implements the `Check` interface:

```typescript
import { Check, Dimension, Finding, ScanContext } from '../../../core/types.js';

export const myCheck: Check = {
  id: 'django/my-check',
  name: 'My Check',
  dimension: Dimension.Security,
  weight: 2,

  async run(context: ScanContext): Promise<Finding> {
    // context.files         — all project file paths
    // context.fileCache     — lazy-populated raw content cache (use for snippets)
    // context.sanitizedFileCache — comments/strings stripped (use for pattern matching)
    // context.projectRoot   — absolute path
    return {
      message: 'Everything looks fine',
      score: 100,
      maxScore: 100,
      severity: 'info',
    };
  },
};
```

### 2. Register your plugin

```typescript
// src/plugins/django/index.ts
import { Plugin, Stack } from '../../core/types.js';
import { PluginRegistry } from '../../core/registry.js';
import { myCheck } from './checks/security.js';

PluginRegistry.register({
  id: 'django',
  stacks: [Stack.Django],          // add Django to the Stack enum in types.ts
  checks: [myCheck],
});
```

### 3. Import in the CLI

```typescript
// src/cli/index.ts
import '../plugins/django/index.js';
```

That's it. No core changes required.

---

## Score interpretation

| Score | Tier | Rating |
|-------|------|--------|
| 90–100 | S | Exceptional — production-grade, actively maintained codebase |
| 80–89 | A | Strong — fundamentally solid with minor gaps |
| 70–79 | B | Solid — meaningful improvement areas exist |
| 60–69 | C | Developing — several dimensions are under-invested |
| 40–59 | D | Needs Attention — reliability and security risk |
| 0–39  | E | Critical — foundational issues need urgent attention |

Each dimension is independently tiered in the report table. The **ceiling score** represents the realistic best-case if every identified gap were resolved — a large gap between your score and ceiling means the issues found are high-impact and worth prioritising.

---

## Development

```bash
npm run build      # compile TypeScript → dist/
npm run typecheck  # type-check without emitting
npm run dev        # run via ts-node (no build step)
```

---

## Roadmap

- [ ] HTML report output
- [ ] Additional stacks: Ruby on Rails, Django, Go
- [ ] Git diff mode (score only changed files)
- [ ] Custom check authoring via `.racoon.json`
