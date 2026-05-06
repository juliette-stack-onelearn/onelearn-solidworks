#!/usr/bin/env node
/**
 * clean-trackers.js
 * Strip dupliqués de pixels (FB / TikTok / Clarity / Pinterest / Datadog / etc.)
 * injectés par GTM au runtime et persistés par accident dans index.html.
 *
 * Approche par-bloc (safe) : on extrait chaque <script>...</script> individuellement
 * et on ne supprime QUE les blocs dont le contenu matche les patterns trackers.
 * Garde les scripts custom OneLearn (first_page_path, GTM, iClosed, save logic, etc.).
 *
 * Usage:
 *   node scripts/clean-trackers.js <file1> [file2] ...
 *   node scripts/clean-trackers.js --all   # tous les index.html du repo
 *   node scripts/clean-trackers.js --dry-run <file>   # simulate, no write
 */

const fs = require('fs');
const path = require('path');

// Patterns qui identifient un script comme étant un tracker injecté
const TRACKER_PATTERNS = [
  /connect\.facebook\.net/,
  /analytics\.tiktok\.com/,
  /clarity\.ms\/tag/,
  /pinterest\.com\/pinit/,
  /browser\.dd-rum/,
  /snap\.licdn\.com/,
  /TiktokAnalyticsObject/,
  /fbevents\.js/,
  /fbq\("init"/,
  /ttq\.load\(/,
];

// Whitelist : scripts à NE JAMAIS supprimer même si signature similaire
const WHITELIST_PATTERNS = [
  /first_page_path/,         // custom OneLearn cookie
  /Strip scripts injectés/,  // editor save logic (mention le mot tracker)
  /saveBtn/,                 // editor save logic
  /googletagmanager\.com/,   // GTM officiel
];

function isTracker(scriptContent) {
  if (WHITELIST_PATTERNS.some(p => p.test(scriptContent))) return false;
  return TRACKER_PATTERNS.some(p => p.test(scriptContent));
}

function clean(html) {
  let removed = 0;
  let bytesRemoved = 0;

  // 1. Strip <script>...</script> blocks dont le contenu = tracker
  // Non-greedy, scoped per-block.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    if (isTracker(match)) {
      removed++;
      bytesRemoved += match.length;
      return '';
    }
    return match;
  });

  // 2. Strip <noscript><img facebook.com/tr ...></noscript> (FB tracking pixel noscript)
  html = html.replace(/<noscript>\s*<img[^>]*facebook\.com\/tr[^>]*>\s*<\/noscript>/gi, (m) => {
    removed++;
    bytesRemoved += m.length;
    return '';
  });

  // 3. Cleanup : supprimer lignes vides consécutives (>2)
  html = html.replace(/\n{3,}/g, '\n\n');

  return { html, removed, bytesRemoved };
}

function processFile(file, dryRun) {
  const before = fs.readFileSync(file, 'utf8');
  const { html, removed, bytesRemoved } = clean(before);
  const sizeBefore = before.length;
  const sizeAfter = html.length;

  console.log(`\n${file}`);
  console.log(`  Before: ${(sizeBefore / 1024).toFixed(1)} KB`);
  console.log(`  After : ${(sizeAfter / 1024).toFixed(1)} KB`);
  console.log(`  Removed: ${removed} block(s) / -${(bytesRemoved / 1024).toFixed(1)} KB`);

  if (dryRun) {
    console.log(`  [DRY-RUN] no write`);
  } else if (removed > 0) {
    fs.writeFileSync(file, html);
    console.log(`  ✅ Cleaned`);
  } else {
    console.log(`  ✓  Already clean`);
  }
  return { sizeBefore, sizeAfter, removed };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  let files = args.filter(a => !a.startsWith('--'));

  if (all) {
    const repoRoot = path.resolve(__dirname, '..');
    files = fs.readdirSync(repoRoot)
      .filter(d => fs.statSync(path.join(repoRoot, d)).isDirectory())
      .filter(d => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts')
      .map(d => path.join(repoRoot, d, 'index.html'))
      .filter(f => fs.existsSync(f));
  }

  if (files.length === 0) {
    console.error('Usage: node clean-trackers.js <file>... | --all [--dry-run]');
    process.exit(1);
  }

  const totals = files.reduce((acc, f) => {
    const r = processFile(f, dryRun);
    acc.before += r.sizeBefore;
    acc.after += r.sizeAfter;
    acc.removed += r.removed;
    return acc;
  }, { before: 0, after: 0, removed: 0 });

  console.log(`\n━━━ TOTAL ━━━`);
  console.log(`  Files: ${files.length}`);
  console.log(`  Total before: ${(totals.before / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Total after : ${(totals.after / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Saved: ${((totals.before - totals.after) / 1024 / 1024).toFixed(2)} MB / ${totals.removed} block(s)`);
}

main();
