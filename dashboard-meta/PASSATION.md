# Passation — Dashboard Meta Ads One Learn

**Date de passation : 1er juillet 2026**  
**URL prod :** https://go.one-learn.fr/dashboard-meta/  
**Créé pour :** One Learn (juliette@one-learn.fr)

---

## 1. C'est quoi ce dashboard ?

Un fichier HTML autonome (1 seul fichier, ~1 500 lignes) qui affiche les performances des campagnes Meta Ads de One Learn (école de formations en ligne, Paris).

Il combine :
- **Données Meta Ads** — lues en live depuis Google Sheets (CSV public, sans auth)
- **Données Pipedrive** — embarquées statiquement dans le HTML (deals + leads), à rafraîchir manuellement

Il est déployé via GitHub Pages sur le repo `solidworks-cms` → domaine `go.one-learn.fr`.

---

## 2. Fichiers & emplacements

| Quoi | Où |
|---|---|
| Fichier source | `/Users/juliette/Downloads/solidworks-cms/dashboard-meta/index.html` |
| Backup v1 | `index.backup-v1.html` (même dossier) |
| Backup pré-MAJ 16 juin | `index.backup-pre-update-20260616.html` |
| Repo git | `/Users/juliette/Downloads/solidworks-cms/` |
| GitHub Pages | `https://go.one-learn.fr/dashboard-meta/` |

Pour déployer : `git add dashboard-meta/index.html && git commit -m "..." && git push` depuis `/Users/juliette/Downloads/solidworks-cms`.

---

## 3. Sources de données

### 3a. Meta Ads (live, automatique)

- **Google Sheet ID :** `1Djqb9kAgEERHhbmtJXEc64rX7D_251diNJXpTXC1sLI`
- **Onglet `Meta Ads`** — colonnes : Date · Campagne · Ad Set · Publicité · Publicité ID · Impressions · Reach · Clics · Dépenses (€) · Leads · Plateforme
- **Onglet `Meta - Creative`** — colonnes : `creative name · creative id · status` (active/inactive) → alimente le badge actif/inactif par créatif + compteur header + filtre "Masquer inactifs"
- Lecture via endpoint gviz CSV public (zéro auth, MAJ 1×/jour)
- ⚠️ Si le nom d'onglet change dans le Sheet, le dashboard ne plante pas mais renvoie silencieusement le 1er onglet — vérifier après tout renommage

### 3b. Pipedrive (statique, à rafraîchir manuellement)

Les données Pipedrive sont **embarquées en dur dans le HTML** sous forme de deux arrays JS :
- `PD_DEALS_RAW` — toutes les affaires (deals)
- `PD_LEADS_DATA` — tous les leads

**Dernière MAJ : 16 juin 2026**  
État à cette date : 107 leads uniques, 34 affaires, 9 gagnées, CA réel 15 800 €

#### Campagnes reconnues (mapping `mapPdCamp`) :
- `Campagne Architecture` ← utm_campaign contient `architecture`
- `Campagne Design & Communication` ← utm_campaign contient `comm_design` ou `reseaux`
- `Campagne Modélisation 3D` ← utm_campaign contient `Blender`, `impression_3d`, `3D`, `Autocad`, `canva`

**Règle :** utm_campaign fait foi ; la formation (`f`) n'est qu'un filet si utm est vide/`nc`.

---

## 4. Comment rafraîchir les données Pipedrive

C'est la seule opération manuelle récurrente (les Meta Ads se mettent à jour seules).

### Étape 1 — Exporter depuis Pipedrive
- **Deals :** exporter toutes les affaires avec les colonnes : date création, date gain, montant, statut, utm_campaign, formation, utm_content
- **Leads :** exporter tous les leads avec : date création, utm_campaign, formation, utm_content
- ⚠️ **Juliette exporte parfois plusieurs fichiers leads qui se chevauchent** → toujours merger et dédupliquer par `Prospect - ID` (ou email en fallback) avant traitement

### Étape 2 — Transformer via script Python
Le script de référence est `/tmp/pd_transform2.py` (peut ne plus exister si la session a été fermée — le recréer à partir de la doc).

Format attendu pour `PD_DEALS_RAW` (un objet par affaire) :
```json
{"c":"2026-06-15","w":"2026-06-15","a":1100,"s":"gagnée","u":"OL_Formation_canva","f":"Canva","ct":"Canva_V3"}
```
- `c` = date création (YYYY-MM-DD)
- `w` = date gain (vide si non gagnée)
- `a` = montant en €
- `s` = statut : `"gagnée"` / `"en cours"` / `"perdue"`
- `u` = utm_campaign
- `f` = formation principale
- `ct` = utm_content (nom du créatif)

Format attendu pour `PD_LEADS_DATA` (un objet par lead) :
```json
{"c":"2026-06-16","u":"OL_Formation_canva","f":"Canva","ct":"Canva_V4"}
```

### Étape 3 — Remplacer dans le HTML
Ligne ~490 du fichier : remplacer `PD_DEALS_RAW = [...]` et `PD_LEADS_DATA = [...]` avec les nouvelles données.

### Étape 4 — Déployer
```bash
cd /Users/juliette/Downloads/solidworks-cms
git add dashboard-meta/index.html
git commit -m "Dashboard Meta: MAJ Pipedrive [date]"
git push
```

---

## 5. Architecture du code (repères)

| Section | Ligne approx. | Description |
|---|---|---|
| CSS variables | ~40 | Palette One Learn (orange, violet, indigo…) |
| `CREA_TAB` | ~410 | Nom de l'onglet créatifs dans le Sheet |
| `CREATIVE_VP` | ~469 | Mapping créatif → proposition de valeur (VIDE — à remplir) |
| `PD_DEALS_RAW` | ~490 | Array statique des deals Pipedrive |
| `PD_LEADS_DATA` | ~491 | Array statique des leads Pipedrive |
| `mapPdCamp()` | ~600 | Mapping utm_campaign → campagne |
| `filterRows()` | ~650 | Filtre global (période + campagne + créatif inactif) |
| Footer HTML | ~404 | "Source : Google Sheets (live, MAJ 1×/jour)" |

---

## 6. Fonctionnalités du dashboard

### Vue principale (mono-page)
- **KPIs header** : Leads · CPL · Dépenses · ROAS · CA
- **Comparaison période précédente** (7j / ce mois / depuis le début)
- **Filtres globaux** : période + campagne
- **Compteur créatifs actifs/inactifs** (depuis l'onglet Meta - Creative)
- **Filtre "Masquer les créatifs inactifs"**

### Sections
1. **Table mensuelle** — performances par mois
2. **Cartes campagnes** — 3 vues : Par Ad Set / Par créatif / Par proposition de valeur
   - Vue "Par créatif" : badge actif/inactif, couleur par Ad Set
   - Vue "Par proposition de valeur" : mapping `CREATIVE_VP` (vide — à compléter)
3. **Pipeline Pipedrive** — Entonnoir Leads → Prospects → Affaires → Gagnés, par campagne
4. **Vue Créatif → Signature** — croise créatifs Meta (utm_content) avec deals Pipedrive (code mort en page, `renderCreativeSignature()` non appelée)

### ROAS
- **ROAS estimé** (défaut) : 18% taux conv × 2 054 € panier moyen — éditable dans l'UI (stocké localStorage)
- **ROAS réel** : calculé automatiquement dès que `PD_DEALS_RAW` contient des deals gagnés

---

## 7. Ce qui est en attente / incomplet

| Feature | État |
|---|---|
| `CREATIVE_VP` | **VIDE** — mapping créatif → proposition de valeur + tag à remplir (liste à demander à Juliette) |
| Vue "Créatif → Signature" | Code mort (non appelée) — tracking utm_content trop récent, 0 deal gagné taggé à ce jour |
| Données Pipedrive | **Figées au 16 juin 2026** — à rafraîchir à la prochaine MAJ mensuelle |

---

## 8. Faire tourner le dashboard en local (preview)

Le dashboard fait des fetch vers Google Sheets → **ne fonctionne PAS en `file://`** (CORS bloque l'origine `null`).

Il faut un serveur local :
```bash
# Copier dans /tmp (pas ~/Documents ni ~/Downloads → bloqué par TCC macOS)
mkdir -p /tmp/ol-dash
cp /Users/juliette/Downloads/solidworks-cms/dashboard-meta/index.html /tmp/ol-dash/

# Créer un mini serveur Node
cat > /tmp/ol-dash-server.js << 'EOF'
const http = require('http');
const fs = require('fs');
const path = require('path');
http.createServer((req, res) => {
  const file = path.join('/tmp/ol-dash', req.url === '/' ? 'index.html' : req.url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200);
    res.end(data);
  });
}).listen(8799, () => console.log('http://localhost:8799'));
EOF

node /tmp/ol-dash-server.js
# Ouvrir http://localhost:8799
```

---

## 9. Contexte One Learn

- **One Learn** : école de formations courtes en ligne, certifiées CPF (QUALIOPI), Paris
- **Formations principales** : BIM/Architecture, Graphisme/Design (Canva, Photoshop), Blender, AutoCAD, Impression 3D, Réseaux sociaux
- **Panier moyen réel** : environ 1 650–2 500 € selon la formation
- **Taux Lead→Vente réel** : ~3,6% (bien inférieur au 18% estimé de départ)
- **Tracking** : iClosed (formulaire → Pipedrive) + utm_campaign / utm_content passés depuis Meta

---

## 10. Contact & accès

| Ressource | Détail |
|---|---|
| Google Sheet (source Meta Ads) | ID `1Djqb9kAgEERHhbmtJXEc64rX7D_251diNJXpTXC1sLI` — accès public en lecture |
| Repo GitHub | `onelearn-solidworks` (solidworks-cms) — push autorisé avec le token configuré |
| URL prod | https://go.one-learn.fr/dashboard-meta/ |
| Responsable | Juliette, juliette@one-learn.fr |
