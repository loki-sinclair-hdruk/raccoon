/**
 * Source-code sanitizer — strips comments and string literals before pattern
 * matching, eliminating false positives from things like:
 *   // TODO: remove this hardcoded password
 *   $error = "no api_key provided";
 *   {/* dangerouslySetInnerHTML example *\/}
 *
 * Key design invariant: newlines are NEVER replaced, so line numbers in the
 * original file map 1:1 to line numbers in the sanitized output.  Every other
 * character inside a comment or string literal is replaced with a space.
 *
 * Usage:
 *   const safe  = readSanitizedFile(context, file);   // pattern matching
 *   const lines = readFile(context, file).split('\n'); // snippet display
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScanContext } from './types.js';

export type Language = 'php' | 'js';

// ─── Core sanitizer ───────────────────────────────────────────────────────────

/**
 * Sanitize source content by replacing comment and string literal content with
 * spaces. Line structure (and therefore line numbers) is fully preserved.
 */
export function sanitize(content: string, lang: Language): string {
  const n = content.length;
  const out = content.split(''); // mutable char array
  let i = 0;

  /** Replace a char with a space unless it's a newline. */
  function blank(idx: number): void {
    if (out[idx] !== '\n') out[idx] = ' ';
  }

  while (i < n) {
    const c  = out[i];
    const c2 = i + 1 < n ? out[i + 1] : '';

    // ── Block comment: /* ... */ ─────────────────────────────────────────────
    if (c === '/' && c2 === '*') {
      blank(i); blank(i + 1); i += 2;
      while (i < n) {
        if (out[i] === '*' && i + 1 < n && out[i + 1] === '/') {
          blank(i); blank(i + 1); i += 2; break;
        }
        blank(i); i++;
      }
      continue;
    }

    // ── Line comment: // ─────────────────────────────────────────────────────
    if (c === '/' && c2 === '/') {
      while (i < n && out[i] !== '\n') { blank(i); i++; }
      continue;
    }

    // ── PHP hash / shell line comment: # ────────────────────────────────────
    if (lang === 'php' && c === '#') {
      while (i < n && out[i] !== '\n') { blank(i); i++; }
      continue;
    }

    // ── Single-quoted string: '...' ──────────────────────────────────────────
    if (c === "'") {
      blank(i); i++;
      while (i < n) {
        if (out[i] === '\\' && i + 1 < n) { blank(i); blank(i + 1); i += 2; continue; }
        if (out[i] === "'") { blank(i); i++; break; }
        blank(i); i++;
      }
      continue;
    }

    // ── Double-quoted string: "..." ──────────────────────────────────────────
    if (c === '"') {
      blank(i); i++;
      while (i < n) {
        if (out[i] === '\\' && i + 1 < n) { blank(i); blank(i + 1); i += 2; continue; }
        if (out[i] === '"') { blank(i); i++; break; }
        blank(i); i++;
      }
      continue;
    }

    // ── JS template literal: `...` (mask everything — no expression support) ─
    if (lang === 'js' && c === '`') {
      blank(i); i++;
      while (i < n) {
        if (out[i] === '\\' && i + 1 < n) { blank(i); blank(i + 1); i += 2; continue; }
        if (out[i] === '`') { blank(i); i++; break; }
        blank(i); i++;
      }
      continue;
    }

    i++;
  }

  return out.join('');
}

// ─── Cached accessor ──────────────────────────────────────────────────────────

/**
 * Return the sanitized (comment/string-stripped) content for a file.
 * Results are cached in `context.sanitizedFileCache`.
 *
 * Infers language from file extension (.php → php, everything else → js).
 */
export function readSanitizedFile(context: ScanContext, rel: string): string {
  if (context.sanitizedFileCache.has(rel)) return context.sanitizedFileCache.get(rel)!;

  // Reuse raw content from the file cache if already loaded
  let raw: string;
  if (context.fileCache.has(rel)) {
    raw = context.fileCache.get(rel)!;
  } else {
    try {
      raw = fs.readFileSync(path.join(context.projectRoot, rel), 'utf8');
      context.fileCache.set(rel, raw);
    } catch {
      raw = '';
    }
  }

  const lang: Language = rel.endsWith('.php') ? 'php' : 'js';
  const sanitized = sanitize(raw, lang);
  context.sanitizedFileCache.set(rel, sanitized);
  return sanitized;
}
