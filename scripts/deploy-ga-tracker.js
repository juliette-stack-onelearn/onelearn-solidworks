#!/usr/bin/env node
/**
 * deploy-ga-tracker.js — Inject unified GA4 dataLayer tracker on all META LP.
 *
 * - Inject le bloc tracker juste avant </body>
 * - Strip le legacy gtag('config') de formation-bim-modeleur-rncp
 * - Idempotent : ré-exécution = remplacement propre (basé sur marqueur __OL_TRACKER_V1__)
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const META_PAGES = [
  'architecture',
  'communication-design',
  'formation-archicad-meta',
  'formation-autocad-meta',
  'formation-bim-modeleur-rncp',
  'formation-blender-meta',
  'formation-canva-meta',
  'formation-impression-3d-meta',
  'formation-reseaux-sociaux-meta',
];

// ─── TRACKER BLOCK ─────────────────────────────────────────────────────────
const TRACKER_BLOCK = `<!-- One Learn — Unified GA4 dataLayer tracker v1 (__OL_TRACKER_V1__) -->
<script>
(function(){
  'use strict';
  if (window.__ol_tracker_v1) return;
  window.__ol_tracker_v1 = true;
  window.dataLayer = window.dataLayer || [];
  var DL = function(o){ try { window.dataLayer.push(o); } catch(e){} };

  // ─── Context global enrichi à chaque event via "ol" namespace ───
  var slug = (location.pathname.replace(/^\\/+|\\/+$/g,'').split('/').pop() || 'home').toLowerCase();
  var qs = new URLSearchParams(location.search);
  var ref = document.referrer || '';
  var traffic = qs.get('utm_source') ||
    (/facebook|instagram|fb\\.com/i.test(ref) ? 'meta' :
     /google\\./i.test(ref) ? 'google_organic' :
     /bing\\./i.test(ref) ? 'bing' :
     /tiktok\\./i.test(ref) ? 'tiktok' :
     /linkedin\\./i.test(ref) ? 'linkedin' :
     (ref && ref.indexOf(location.host) === -1) ? 'referral' : 'direct');
  var fp = (document.cookie.match(/first_page_path=([^;]+)/) || [])[1];
  fp = fp ? decodeURIComponent(fp) : location.pathname;
  var dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ?
    (/iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'mobile') : 'desktop';

  var CTX = {
    lp_id: slug,
    lp_traffic_source: traffic,
    lp_campaign: qs.get('utm_campaign') || null,
    lp_medium: qs.get('utm_medium') || null,
    lp_content: qs.get('utm_content') || null,
    lp_term: qs.get('utm_term') || null,
    lp_first_path: fp,
    lp_device: dev,
    lp_referrer: ref.substring(0, 200)
  };
  function ev(name, extra){ DL({ event: name, ol: Object.assign({}, CTX, extra || {}) }); }
  ev('lp_context_ready');

  // ─── 1. CTA + tel + select_content + outbound (un seul listener) ───
  document.addEventListener('click', function(e){
    var a = e.target.closest('a, button'); if (!a) return;
    var href = (a.getAttribute('href') || '').toLowerCase();
    var txt = ((a.innerText || a.getAttribute('aria-label') || '').trim()).substring(0, 80);

    // tel: clicks
    if (href.indexOf('tel:') === 0){
      ev('tel_click', { tel_number: href.replace('tel:', '').substring(0, 30) });
      return;
    }

    // CTA principal (réserver/appel/éligibilité/iclosed/#rdv)
    var isCta = href.indexOf('#rdv') !== -1 || href.indexOf('iclosed') !== -1 ||
                /réserver|reserver|appel|découvrir|decouvrir|éligibilité|eligibilite|inscrire/i.test(txt);
    if (isCta){
      var sec = a.closest('section'); var sid = (sec && sec.id) || 'unknown';
      var pos = 'body', p = a;
      while (p && p !== document.body){
        var cs;
        try { cs = getComputedStyle(p); } catch(_){ break; }
        if (cs && (cs.position === 'sticky' || cs.position === 'fixed')){ pos = 'sticky'; break; }
        p = p.parentElement;
      }
      if (pos === 'body'){
        if (sid === 'rdv') pos = 'final';
        else if (window.pageYOffset < 200) pos = 'hero';
      }
      ev('cta_click', { cta_position: pos, cta_section: sid, cta_label: txt, cta_href: href.substring(0,200) });
    }

    // Formation card click (lien vers /formations/X)
    var fm = href.match(/one-learn\\.fr\\/formations\\/([^?#\\/]+)/i);
    if (fm){
      ev('select_content', { content_type: 'formation', item_id: fm[1] });
    }

    // Outbound (hors one-learn.fr et iclosed)
    if (/^https?:\\/\\//.test(href) && href.indexOf(location.host) === -1 &&
        href.indexOf('one-learn.fr') === -1 && href.indexOf('iclosed') === -1){
      ev('outbound_click', { link_url: href.substring(0, 200), link_text: txt });
    }
  }, true);

  // ─── 2. FAQ open ───
  document.addEventListener('click', function(e){
    var s = e.target.closest('summary, [data-faq-toggle]');
    if (!s) return;
    ev('faq_open', { faq_question: (s.innerText || '').trim().substring(0, 120) });
  }, true);

  // ─── 3. Sections clés + iClosed form view + pricing/promo view ───
  if (window.IntersectionObserver){
    var seen = {};
    var SECTIONS = [
      ['#catalogue','catalogue'],['#financement','financement'],
      ['#avis','avis'],['#faq','faq'],['#rdv','rdv'],
      ['#temoignages','temoignages'],['#formateurs','formateurs'],['#programme','programme']
    ];
    SECTIONS.forEach(function(s){
      var el = document.querySelector(s[0]); if (!el) return;
      new IntersectionObserver(function(en, ob){
        if (en[0].isIntersecting && !seen[s[1]]){
          seen[s[1]] = 1;
          ev('section_view', { section_id: s[1] });
          ob.disconnect();
        }
      }, { threshold: 0.3 }).observe(el);
    });

    // iClosed widget visible
    var ic = document.querySelector('.iclosed-widget');
    if (ic){
      var ob = new IntersectionObserver(function(en){
        if (en[0].isIntersecting){ ev('iclosed_form_view'); ob.disconnect(); }
      }, { threshold: 0.3 });
      ob.observe(ic);
    }

    // Pricing (1er bloc avec line-through détecté)
    var pricingEl = document.querySelector('[class*="line-through"]');
    if (pricingEl){
      var pob = new IntersectionObserver(function(en){
        if (en[0].isIntersecting && !seen._pricing){ seen._pricing = 1; ev('pricing_view'); pob.disconnect(); }
      }, { threshold: 0.5 });
      pob.observe(pricingEl);
    }

    // Promo bar (top-bar / data-promo)
    var promoEl = document.querySelector('.top-bar, [data-promo], [class*="promo"]');
    if (promoEl){
      var prob = new IntersectionObserver(function(en){
        if (en[0].isIntersecting && !seen._promo){ seen._promo = 1; ev('promo_view'); prob.disconnect(); }
      }, { threshold: 0.5 });
      prob.observe(promoEl);
    }
  }

  // ─── 4. Engagement thresholds (15/30/60/120/300s actifs) ───
  var marks = [15, 30, 60, 120, 300];
  var engaged = 0, last = Date.now(), active = !document.hidden;
  setInterval(function(){
    if (active) engaged += (Date.now() - last) / 1000;
    last = Date.now();
    marks = marks.filter(function(m){
      if (engaged >= m){ ev('engagement_threshold', { engaged_seconds: m }); return false; }
      return true;
    });
  }, 5000);
  document.addEventListener('visibilitychange', function(){ active = !document.hidden; last = Date.now(); });

  // ─── 5. iClosed postMessage → generate_lead (la conversion finale) ───
  window.addEventListener('message', function(m){
    if (!m.origin || m.origin.indexOf('iclosed.io') === -1) return;
    var d = m.data || {};
    // Log brut pour debug GTM (à retirer après confirmation pattern iClosed)
    ev('iclosed_message_raw', { iclosed_raw: typeof d === 'string' ? d.substring(0,200) : JSON.stringify(d).substring(0,500) });
    var sig = (typeof d === 'string' ? d : JSON.stringify(d)).toLowerCase();
    if (/booked|booking_confirmed|appointment_scheduled|meeting_scheduled|appointment_confirmed/.test(sig) &&
        !/cancel|fail|error/.test(sig)){
      ev('generate_lead', { lead_source: 'iclosed', value: 50, currency: 'EUR' });
    }
  });

  // ─── 6. Rage click (3+ clics même cible <1s) ───
  var buf = [];
  document.addEventListener('click', function(e){
    var t = e.target; var now = Date.now();
    buf = buf.filter(function(c){ return now - c.t < 1000 && c.x === t; });
    buf.push({ x: t, t: now });
    if (buf.length >= 3){
      var id = (t.tagName||'').toLowerCase() + (t.id ? '#'+t.id : '') + (t.className ? '.'+String(t.className).split(' ')[0] : '');
      ev('rage_click', { rage_element: id.substring(0, 80) });
      buf = [];
    }
  });

  // ─── 7. JS errors (debug + diag perf) ───
  window.addEventListener('error', function(er){
    ev('js_error', {
      error_message: (er.message || '').substring(0, 200),
      error_file: (er.filename || '').substring(0, 200),
      error_line: er.lineno || 0
    });
  });

  // ─── 8. Web Vitals natifs (LCP / CLS / INP) ───
  try {
    if ('PerformanceObserver' in window){
      new PerformanceObserver(function(l){
        var es = l.getEntries(); var lst = es[es.length-1];
        ev('web_vital', { metric_name: 'LCP', metric_value: Math.round(lst.renderTime || lst.loadTime || 0) });
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      var cls = 0;
      new PerformanceObserver(function(l){
        l.getEntries().forEach(function(e){ if (!e.hadRecentInput) cls += e.value; });
      }).observe({ type: 'layout-shift', buffered: true });
      window.addEventListener('pagehide', function(){
        ev('web_vital', { metric_name: 'CLS', metric_value: Math.round(cls * 1000) / 1000 });
      }, { once: true });

      new PerformanceObserver(function(l){
        l.getEntries().forEach(function(e){
          if (e.duration > 40){
            ev('web_vital', { metric_name: 'INP', metric_value: Math.round(e.duration), metric_event_type: e.name });
          }
        });
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    }
  } catch(e){}
})();
</script>
<!-- /__OL_TRACKER_V1__ -->`;

// ─── LEGACY GTAG BLOCK (à supprimer sur bim-modeleur-rncp) ────────────────
// Match les 2 scripts qui suivent le commentaire "Google Analytics 4, One Learn Landing Pages"
const LEGACY_GTAG_REGEX = /\s*<!--\s*Google Analytics 4[^>]*-->\s*<script[^>]*googletagmanager\.com\/gtag\/js[^>]*><\/script>\s*<script>[\s\S]*?gtag\('config'[\s\S]*?<\/script>/;

// ─── EXISTING TRACKER (à remplacer si déjà présent — idempotence) ──────────
const EXISTING_TRACKER_REGEX = /\s*<!--\s*One Learn — Unified GA4[\s\S]*?<!--\s*\/__OL_TRACKER_V1__\s*-->/;

function processPage(slug){
  const file = path.join(REPO_ROOT, slug, 'index.html');
  if (!fs.existsSync(file)){ console.log('SKIP (missing):', slug); return; }
  let html = fs.readFileSync(file, 'utf8');
  const orig = html;

  // 1) Strip legacy gtag block (n'affecte que bim-modeleur-rncp)
  let legacyRemoved = false;
  if (LEGACY_GTAG_REGEX.test(html)){
    html = html.replace(LEGACY_GTAG_REGEX, '');
    legacyRemoved = true;
  }

  // 2) Strip existing tracker (idempotence)
  let trackerReplaced = false;
  if (EXISTING_TRACKER_REGEX.test(html)){
    html = html.replace(EXISTING_TRACKER_REGEX, '');
    trackerReplaced = true;
  }

  // 3) Inject tracker juste avant </body>
  if (!/<\/body>/i.test(html)){ console.log('NO </body>:', slug); return; }
  html = html.replace(/<\/body>/i, '\n' + TRACKER_BLOCK + '\n</body>');

  if (html === orig){ console.log('NO CHANGE:', slug); return; }
  fs.writeFileSync(file, html);
  const flags = [];
  if (legacyRemoved) flags.push('legacy-stripped');
  if (trackerReplaced) flags.push('tracker-replaced');
  else flags.push('tracker-added');
  console.log('OK ' + slug + ' :: ' + flags.join(', '));
}

META_PAGES.forEach(processPage);
console.log('\\nDone.');
