#!/usr/bin/env node
/**
 * normalize-page.js — Idempotent normalizer for One Learn LP pages.
 *
 * Garantit, sur chaque page index.html :
 *   1. EXACTEMENT 1 bloc GTM head (au tout début du <head>)
 *   2. EXACTEMENT 1 bloc GTM noscript (juste après <body>)
 *   3. EXACTEMENT 1 bloc Axeptio (dans <head>, après GTM)
 *   4. ZÉRO tracker injecté en doublon (FB, TikTok, Clarity, Pinterest, Datadog, etc.)
 *
 * Idempotent : exécuter 2 fois = même résultat.
 * Safe : parsing par-bloc, jamais de regex glouton cross-script.
 *
 * Usage :
 *   node scripts/normalize-page.js <file>...           # 1 ou plusieurs fichiers
 *   node scripts/normalize-page.js --all               # tous les index.html
 *   node scripts/normalize-page.js --check <file>...   # exit 1 si anomalie (CI)
 *   node scripts/normalize-page.js --dry-run <file>... # simule, n'écrit pas
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ─── BLOCS DE RÉFÉRENCE (source de vérité) ───────────────────────────────────

const GTM_HEAD = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-M9FPBBB');</script>
<!-- End Google Tag Manager -->`;

const GTM_NOSCRIPT = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-M9FPBBB"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

const AXEPTIO = `<!-- Axeptio Cookie Consent -->
<script>
window.axeptioSettings = {
  clientId: "630de1b500fec812caa2de5e",
  cookiesVersion: "one learn-fr",
};

(function(d, s) {
  var t = d.getElementsByTagName(s)[0], e = d.createElement(s);
  e.async = true; e.src = "//static.axept.io/sdk.js";
  t.parentNode.insertBefore(e, t);
})(document, "script");
</script>
<!-- End Axeptio Cookie Consent -->`;

// ─── PATTERNS DE DÉTECTION ───────────────────────────────────────────────────

// Un script est considéré comme tracker si SON CONTENU matche un de ces patterns.
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

// Whitelist absolue : ne JAMAIS supprimer ces scripts (même si signature suspecte)
const WHITELIST_PATTERNS = [
  /first_page_path/,
  /Strip scripts injectés/,
  /saveBtn/,
  /_ol_token/,
  /_fireConfetti/,
  /reveal/,
  /IntersectionObserver/,
];

// Patterns pour identifier les blocs déjà-en-place (à supprimer pour réinjecter)
const GTM_HEAD_PATTERNS = [
  /<!--\s*Google Tag Manager\s*-->[\s\S]*?<!--\s*End Google Tag Manager\s*-->/g,
];

const GTM_NOSCRIPT_PATTERNS = [
  /<!--\s*Google Tag Manager \(noscript\)\s*-->[\s\S]*?<!--\s*End Google Tag Manager \(noscript\)\s*-->/g,
];

const AXEPTIO_PATTERNS = [
  /<!--\s*Axeptio Cookie Consent\s*-->[\s\S]*?<!--\s*End Axeptio Cookie Consent\s*-->/g,
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isTracker(scriptBody) {
  if (WHITELIST_PATTERNS.some(p => p.test(scriptBody))) return false;
  return TRACKER_PATTERNS.some(p => p.test(scriptBody));
}

function isGtmScript(scriptBody) {
  return /googletagmanager\.com\/gtm\.js/.test(scriptBody);
}

function isGtmNoscript(scriptBody) {
  return /googletagmanager\.com\/ns\.html/.test(scriptBody);
}

function isAxeptioScript(scriptBody) {
  return /axeptioSettings/.test(scriptBody) || /static\.axept\.io\/sdk/.test(scriptBody);
}

// ─── NORMALIZATION ───────────────────────────────────────────────────────────

function isMerciPage(filePath) {
  // Pages "merci-*" (thank-you post-conversion) : visiteur a déjà accepté les cookies
  // sur la LP en amont. Pas besoin de re-charger Axeptio.
  return /(?:^|\/)merci-[^/]+\/index\.html$/.test(filePath);
}

function normalize(html, opts = {}) {
  const { injectAxeptio = true } = opts;
  const stats = { trackersRemoved: 0, gtmRemoved: 0, axeptioRemoved: 0, fbNoscriptRemoved: 0 };

  // 1) Strip GTM blocks (commentaire-wrapped)
  GTM_HEAD_PATTERNS.forEach(p => {
    html = html.replace(p, () => { stats.gtmRemoved++; return ''; });
  });
  GTM_NOSCRIPT_PATTERNS.forEach(p => {
    html = html.replace(p, () => { stats.gtmRemoved++; return ''; });
  });

  // 2) Strip Axeptio blocks (commentaire-wrapped)
  AXEPTIO_PATTERNS.forEach(p => {
    html = html.replace(p, () => { stats.axeptioRemoved++; return ''; });
  });

  // 3) Strip <script>...</script> blocs : trackers + GTM bare + Axeptio bare
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    if (isTracker(match)) { stats.trackersRemoved++; return ''; }
    if (isGtmScript(match)) { stats.gtmRemoved++; return ''; }
    if (isAxeptioScript(match)) { stats.axeptioRemoved++; return ''; }
    return match;
  });

  // 4) Strip <noscript> blocks GTM-bare + FB pixels
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, (match) => {
    if (isGtmNoscript(match)) { stats.gtmRemoved++; return ''; }
    if (/facebook\.com\/tr/i.test(match)) { stats.fbNoscriptRemoved++; return ''; }
    return match;
  });

  // 5) Cleanup : supprimer lignes vides multiples (>2)
  html = html.replace(/\n{3,}/g, '\n\n');

  // 6) Réinjecter les 3 blocs canoniques

  // GTM head — juste après <head> ou <head ...>
  if (!/<head[^>]*>/i.test(html)) {
    throw new Error('Pas de balise <head> trouvée — fichier suspect');
  }
  html = html.replace(/(<head[^>]*>)/i, `$1\n${GTM_HEAD}\n`);

  // Axeptio — juste avant </head> (dans head, après GTM)
  // Skip pour les pages merci-* (visiteur a déjà accepté les cookies sur la LP)
  if (injectAxeptio) {
    html = html.replace(/(<\/head>)/i, `${AXEPTIO}\n$1`);
  }

  // GTM noscript — juste après <body> ou <body ...>
  if (!/<body[^>]*>/i.test(html)) {
    throw new Error('Pas de balise <body> trouvée — fichier suspect');
  }
  html = html.replace(/(<body[^>]*>)/i, `$1\n${GTM_NOSCRIPT}\n`);

  return { html, stats };
}

// ─── CHECK MODE (CI / hook) ──────────────────────────────────────────────────

function checkPage(html, filePath) {
  const issues = [];
  const isMerci = filePath ? isMerciPage(filePath) : false;

  const gtmHeadCount = (html.match(/googletagmanager\.com\/gtm\.js/g) || []).length;
  if (gtmHeadCount === 0) issues.push('Pas de GTM head');
  if (gtmHeadCount > 1) issues.push(`GTM head x${gtmHeadCount}`);

  const gtmNsCount = (html.match(/googletagmanager\.com\/ns\.html/g) || []).length;
  if (gtmNsCount === 0) issues.push('Pas de GTM noscript');
  if (gtmNsCount > 1) issues.push(`GTM noscript x${gtmNsCount}`);

  const axCount = (html.match(/static\.axept\.io\/sdk/g) || []).length;
  if (isMerci) {
    if (axCount > 0) issues.push(`Axeptio inutile sur merci-* x${axCount}`);
  } else {
    if (axCount === 0) issues.push('Pas d\'Axeptio');
    if (axCount > 1) issues.push(`Axeptio x${axCount}`);
  }

  const fbCount = (html.match(/connect\.facebook\.net/g) || []).length;
  if (fbCount > 0) issues.push(`FB Pixel inline x${fbCount}`);

  const ttCount = (html.match(/analytics\.tiktok\.com/g) || []).length;
  if (ttCount > 0) issues.push(`TikTok Pixel inline x${ttCount}`);

  const clCount = (html.match(/clarity\.ms\/tag/g) || []).length;
  if (clCount > 0) issues.push(`Clarity inline x${clCount}`);

  return issues;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function processFile(file, opts) {
  const before = fs.readFileSync(file, 'utf8');
  const sizeBefore = before.length;

  if (opts.check) {
    const issues = checkPage(before, file);
    if (issues.length === 0) {
      console.log(`  ✅ ${file}`);
      return { ok: true };
    } else {
      console.log(`  ❌ ${file}\n     ${issues.join(' · ')}`);
      return { ok: false };
    }
  }

  const { html, stats } = normalize(before, { injectAxeptio: !isMerciPage(file) });
  const sizeAfter = html.length;
  const delta = sizeBefore - sizeAfter;

  const summary = [
    `trackers=${stats.trackersRemoved}`,
    `gtm=${stats.gtmRemoved}`,
    `axeptio=${stats.axeptioRemoved}`,
    `fb_noscript=${stats.fbNoscriptRemoved}`,
  ].join(' ');

  console.log(`\n${path.relative(REPO_ROOT, file)}`);
  console.log(`  ${(sizeBefore/1024).toFixed(1)} KB → ${(sizeAfter/1024).toFixed(1)} KB (${delta>=0?'-':'+'}${Math.abs(delta/1024).toFixed(1)} KB)`);
  console.log(`  Removed: ${summary}`);

  if (opts.dryRun) {
    console.log(`  [DRY-RUN] not written`);
  } else if (html !== before) {
    fs.writeFileSync(file, html);
    console.log(`  ✅ Normalized`);
  } else {
    console.log(`  ✓ Already normalized (idempotent)`);
  }

  return { ok: true, delta };
}

function discoverAllPages() {
  return fs.readdirSync(REPO_ROOT)
    .filter(d => fs.statSync(path.join(REPO_ROOT, d)).isDirectory())
    .filter(d => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts')
    .map(d => path.join(REPO_ROOT, d, 'index.html'))
    .filter(f => fs.existsSync(f));
}

function main() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: args.includes('--dry-run'),
    check: args.includes('--check'),
    all: args.includes('--all'),
  };
  let files = args.filter(a => !a.startsWith('--'));
  if (opts.all) files = discoverAllPages();

  if (files.length === 0) {
    console.error(`Usage:
  node scripts/normalize-page.js <file>...
  node scripts/normalize-page.js --all
  node scripts/normalize-page.js --check <file>...
  node scripts/normalize-page.js --dry-run <file>...`);
    process.exit(1);
  }

  let ok = true;
  let totalDelta = 0;

  files.forEach(f => {
    try {
      const r = processFile(f, opts);
      if (!r.ok) ok = false;
      totalDelta += r.delta || 0;
    } catch (e) {
      console.error(`  ❌ ERROR: ${f}\n     ${e.message}`);
      ok = false;
    }
  });

  console.log(`\n━━━ TOTAL ━━━`);
  console.log(`  Files processed: ${files.length}`);
  if (!opts.check) console.log(`  Total saved: ${(totalDelta/1024).toFixed(1)} KB`);
  if (opts.check && !ok) {
    console.log(`  ❌ Anomalies detected. Run without --check to autofix.`);
    process.exit(1);
  }
  if (!ok) process.exit(1);
}

main();
