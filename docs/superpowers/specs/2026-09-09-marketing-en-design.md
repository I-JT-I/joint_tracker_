# Project B — Sito marketing bilingue (IT/EN)

**Data:** 2026-09-09
**Branch:** `feat/marketing-en`
**Stato:** design approvato, in attesa di piano di implementazione

## Obiettivo

Rendere il sito marketing di JointTracker accessibile a un pubblico anglofono
con URL statici dedicati `/en/…`, traduzioni complete, annotazioni `hreflang`
e uno switcher di lingua su ogni pagina. Nessuna modifica alla SPA `/app`
(che ha già un i18n proprio ed è `noindex`).

Motivazione: oggi tutto il sito pubblico è solo in italiano; un utente o un
motore di ricerca anglofono non ha una versione inglese indicizzabile a cui
arrivare. La landing `index.html` ha già attributi `data-i18n` ma sono inerti
(nessuno script i18n viene caricato lato marketing).

## Decisioni prese in fase di brainstorming

| Tema | Decisione |
|---|---|
| Guscio condiviso | Templating a build time da partial condivisi (niente framework/runtime) |
| Slug EN | Tradotti in inglese (non `/en/` + slug italiano) |
| Root `/` | Resta italiana; `x-default` → versione IT; nessun redirect automatico per lingua |
| Traduzioni | Claude bozza tutto l'EN sul branch; nessun merge prima della revisione di Matteo |
| `vercel.json` | `"cleanUrls": true` sostituisce l'array `rewrites` |
| Banner soft | Incluso: suggerisce l'inglese ai browser non-IT, dismissible, **nessun redirect** |

## Mappa URL

| Pagina (chiave logica) | IT | EN |
|---|---|---|
| `home` | `/` | `/en/` |
| `how-it-works` | `/come-funziona` | `/en/how-it-works` |
| `faq` | `/faq` | `/en/faq` |
| `blog-index` | `/blog` | `/en/blog` |
| `blog/tolerance-break` | `/blog/cose-una-tolerance-break` | `/en/blog/what-is-a-tolerance-break` |
| `blog/cut-down` | `/blog/come-ridurre-il-consumo-di-cannabis` | `/en/blog/how-to-cut-down-cannabis-use` |
| `blog/diary` | `/blog/perche-tenere-un-diario-di-consumo` | `/en/blog/why-keep-a-consumption-diary` |

14 URL totali (7 IT + 7 EN).

## Architettura

### Riorganizzazione dei sorgenti

I file HTML marketing top-level di oggi (`index.html`, `come-funziona.html`,
`faq.html`, `blog/index.html`, `blog/*.html`) vengono **rimossi** e sostituiti
da fragment di solo-contenuto sotto `marketing/`:

```
marketing/
  routes.json            # unica fonte di verità: pagine, slug IT/EN, title, description, og:type, flag "landing"
  layout.html            # guscio con slot: {{LANG}} {{HEAD}} {{NAV}} {{MAIN}} {{FOOTER}}
  partials/
    head-common.html     # icone, theme-color, manifest, analytics, speed-insights, script PWA/standalone-redirect
    nav.it.html   nav.en.html
    footer.it.html   footer.en.html
  content/
    it/
      home.html  how-it-works.html  faq.html  blog-index.html
      blog/tolerance-break.html  blog/cut-down.html  blog/diary.html
    en/
      (stessi nomi/chiavi, prosa inglese)
```

**Regole per i fragment (`content/**`):**

- Contengono solo il corpo della pagina (`<header>`, `<section>`, `<article>`,
  `<main>` …), non `<html>`/`<head>`/`<nav>`/`<footer>`.
- Includono inline il proprio blocco `<script type="application/ld+json">`
  (FAQPage per la FAQ, Article per i post, WebApplication per la home). Lo
  schema si traduce accanto alla prosa.
- Gli script per-pagina che non sono i18n-dipendenti (es. l'apri-`<details>`
  della FAQ su `#hash`, lo script `beforeinstallprompt`/`appinstalled` della
  home, il redirect standalone→`/app`) vivono in `partials/head-common.html`
  o, se strettamente legati al contenuto, in fondo al fragment. Da decidere
  puntualmente nel piano; criterio: se il testo che mostrano è localizzato,
  il testo sta nel fragment.

### Templating a build time

Nuovo modulo `build-marketing.mjs`, invocato da `build.mjs`. Funzione pura:

```
(routes.json + layout.html + partials + content/**) → dist/** + dist/sitemap.xml
```

Per ogni coppia (pagina × lingua):

1. Sceglie i partial della lingua (`nav.<lang>.html`, `footer.<lang>.html`).
2. Costruisce `<head>` da `routes.json`: `<title>`, `<meta name=description>`,
   `<link rel=canonical>` (self), blocco `hreflang` (vedi sotto), `og:*` /
   `twitter:*` con `og:locale` corretto, `head-common.html`, e — se
   `routes.json` marca la pagina come `landing` — il preconnect ai Google
   Fonts + `<link rel=stylesheet href="/landing.css">`.
3. Inietta nel nav lo switcher di lingua con `href` = URL gemello nell'altra
   lingua (calcolato da `routes.json`).
4. Assembla `layout.html` con gli slot e scrive il file:
   - IT → `dist/<it-slug>.html` (top-level, come oggi); home → `dist/index.html`;
     blog → `dist/blog/<name>.html`, `dist/blog/index.html`.
   - EN → `dist/en/<en-slug>.html`; home EN → `dist/en/index.html`;
     blog EN → `dist/en/blog/<name>.html`, `dist/en/blog/index.html`.

Nessuna dipendenza nuova: sola manipolazione di stringhe in Node, coerente con
la pipeline esbuild esistente in `build.mjs`.

### `build.mjs` — modifiche

- Importa e chiama `buildMarketing()` dopo la copia degli `STATIC_ENTRIES` e
  l'hashing di `app.js`/`i18n.js`/`style.css` (invariati).
- `STATIC_ENTRIES` **perde**: `index.html`, `come-funziona.html`, `faq.html`,
  `blog`, `sitemap.xml`.
- `STATIC_ENTRIES` **mantiene**: `marketing.css`, `landing.css`, `og-image.png`,
  `admin.html`, `manifest.json`, `robots.txt`, `favicon*`, `icon*`, `apple-touch-icon.png`,
  `locales`, `splash`, `img`.
- `app/index.html`, `sw.js` e l'hashing: nessuna modifica.

### hreflang e metadati SEO

In `<head>` di **ogni** pagina, generati da `routes.json`
(base `https://joint-tracker.vercel.app`):

```html
<link rel="canonical" href="{URL self}">
<link rel="alternate" hreflang="it"        href="{base}/{it-slug}">
<link rel="alternate" hreflang="en"        href="{base}/en/{en-slug}">
<link rel="alternate" hreflang="x-default" href="{base}/{it-slug}">
```

- `<html lang>` = `it` | `en`.
- `og:locale` = `it_IT` | `en_US`; `og:locale:alternate` = l'altra.
- `og:url` / `og:type` / titoli / description tradotti da `routes.json`.
- **`dist/sitemap.xml` generato** dal build (rimosso dai sorgenti): 14 `<url>`,
  ognuno con `<xhtml:link rel="alternate" hreflang="…">` per `it` / `en` /
  `x-default` (namespace `xmlns:xhtml`). `changefreq`/`priority` ripresi
  dai valori attuali per le pagine IT e replicati sulle EN.
- `robots.txt`: invariato (`Allow: /` copre `/en/`; `Disallow: /admin` resta).

### `vercel.json`

- L'array `rewrites` (8 voci) viene sostituito da `"cleanUrls": true`.
  Vercel serve `dist/foo.html` all'URL `/foo`, `dist/en/blog/x.html` a
  `/en/blog/x`, gli `index.html` alla radice della cartella, e fa redirect
  308 da `.html` → URL pulito. `/app` (`dist/app/index.html`) e `/admin`
  (`dist/admin.html`) continuano a risolvere senza rewrite espliciti.
- Blocco `headers`: invariato.
- **Fallback** (se `cleanUrls` desse problemi): reintrodurre l'array
  `rewrites` con le 14 voci esplicite (8 attuali + 6 EN + `/en`).

### Sviluppo locale

`.claude/serve.json` (config di `npx serve` usata in locale, già presente per
il rewrite `/app`) va aggiornato per rispecchiare `cleanUrls` — impostare
`"cleanUrls": true` e rimuovere i rewrite marketing ridondanti, mantenendo
solo ciò che serve alla SPA. Verificare che `serve dist` da solo (senza
config, dato che i file sono già ai path giusti) copra tutti i 14 URL.

### Switcher di lingua

- Posizione: nel `nav` (partial), come pill discreta accanto a "Apri l'app" /
  "Open the app"; replicata nel `footer`.
- Testo: su pagina IT mostra **EN**, su pagina EN mostra **IT**.
- `href`: URL della pagina gemella nell'altra lingua (mai la home generica —
  ogni pagina ha un gemello 1:1).
- `hreflang` attribute sul link stesso per coerenza.

### Banner soft di suggerimento lingua

Script inline in `layout.html` (~15 righe, no dipendenze):

- Condizioni per mostrarlo: pagina servita è IT **e** `navigator.language`
  (e `navigator.languages`) non iniziano per `it` **e**
  `localStorage['jt_lang_hint']` non è `'dismissed'`.
- Rende una striscia in cima alla pagina: *"This page is also available in
  English →"* con link alla pagina gemella EN e una **×** per chiuderla
  (che scrive `jt_lang_hint = 'dismissed'`).
- **Nessun redirect automatico** in nessun caso (SEO-safe: niente cloaking,
  Googlebot vede sempre la pagina IT su URL IT).
- Simmetrico opzionale sulle pagine EN per browser IT (da confermare nel
  piano; default: solo IT→EN, che è il caso d'uso richiesto).

## Traduzioni

- Claude produce le bozze EN di: `home`, `how-it-works`, `faq` (prosa +
  8 Q&A + schema FAQPage), `blog-index`, e i 3 post completi (prosa + schema
  Article + `<title>`/description/og).
- Tono: adeguare all'inglese naturale, non traduzione letterale; mantenere le
  keyword ("cannabis tracker", "tolerance break tracker", "weed diary" dove
  sensato) per la SEO EN.
- Artefatto di revisione: `docs/superpowers/i18n-review-en.md` — tabella
  sezione-per-sezione IT ↔ bozza EN.
- **Gate:** nessun merge su `main` prima dell'approvazione esplicita di Matteo
  sulle traduzioni.

## Testing

1. `npm run build` → `npx serve dist` → percorrere tutti i 14 URL.
2. Per ogni pagina: tema chiaro/scuro, viewport 375px + desktop, 0 errori
   console/network.
3. Script di verifica (nel repo o one-off):
   - reciprocità `hreflang` (ogni URL IT punta al suo EN e viceversa; ogni
     pagina include il trio it/en/x-default);
   - `<link rel=canonical>` = self su ogni pagina;
   - esattamente 1 blocco JSON-LD valido per pagina;
   - `sitemap.xml` ben formata, 14 `<url>`, ognuna con i 3 `xhtml:link`.
4. Lighthouse mobile su `/` e `/en/`: parità con il baseline attuale
   (perf ~95 / a11y 100 / SEO 100 / BP ~96).
5. Screenshot di prova (home IT, home EN, una FAQ EN, un post EN) inviati a
   Matteo prima del merge.
6. Diff di controllo: l'output IT renderizzato deve coincidere con le pagine
   IT attuali a meno del blocco `hreflang`, dello switcher lingua e
   dell'eventuale banner (che su browser IT non compare).

## Fuori scope

- SPA `/app` (i18n proprio via `i18n.js` + `locales/`, `noindex`).
- `admin.html`.
- Lingue oltre IT/EN.
- Redirect automatico per `Accept-Language` / `navigator.language`.
- Modifiche ai testi italiani esistenti (solo estrazione verbatim nei fragment).
- Traduzione EN della UI dell'app o delle notifiche push.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Regressione sulle 6 pagine IT durante il refactoring in fragment | Estrarre il contenuto IT verbatim; diff di controllo (test #6) |
| `cleanUrls` cambia comportamento di URL esistenti (redirect `.html`→pulito) | È un miglioramento (dedup canonico); fallback `rewrites` espliciti documentato |
| Schema JSON-LD tradotto male / duplicato | Test #3 valida 1 blocco valido/pagina; review doc include lo schema |
| `serve` locale non rispecchia `cleanUrls` di Vercel | Aggiornare `.claude/serve.json`; i file sono comunque ai path finali |
| Slug EN scelti ora e poi cambiati = URL rotti dopo l'indicizzazione | Slug decisi in questo design e congelati; se cambiano, aggiungere redirect 308 |

## File toccati (riepilogo)

**Nuovi:**
- `marketing/routes.json`
- `marketing/layout.html`
- `marketing/partials/{head-common,nav.it,nav.en,footer.it,footer.en}.html`
- `marketing/content/it/**` (7 fragment, estratti dagli HTML attuali)
- `marketing/content/en/**` (7 fragment tradotti)
- `build-marketing.mjs`
- `docs/superpowers/i18n-review-en.md`

**Modificati:**
- `build.mjs` (chiamata a `buildMarketing()`, `STATIC_ENTRIES`)
- `vercel.json` (`cleanUrls`)
- `.claude/serve.json`
- `CLAUDE.md` (sezione struttura sito / build)

**Rimossi:**
- `index.html`, `come-funziona.html`, `faq.html`, `blog/` (sorgenti; l'output resta in `dist/`)
- `sitemap.xml` (ora generato)
