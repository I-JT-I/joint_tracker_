# Project B — Sito marketing bilingue (IT/EN) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servire ogni pagina marketing di JointTracker anche in inglese su URL statici `/en/…`, con `hreflang`, sitemap generata, switcher di lingua e un banner soft di suggerimento, senza framework.

**Architecture:** I file HTML marketing top-level vengono sostituiti da fragment di solo-contenuto sotto `marketing/`, montati a build time da `build-marketing.mjs` dentro un `layout.html` con partial condivisi per shell/nav/footer, una volta per lingua. `routes.json` è l'unica fonte di verità per slug, metadati e `hreflang`; `vercel.json` passa a `cleanUrls`. Uno script `verify-marketing.mjs` valida l'output ad ogni build.

**Tech Stack:** Node ESM puro (nessuna dipendenza nuova), esbuild (già presente, invariato), Vercel static hosting, `npx serve` per il locale.

**Spec:** `docs/superpowers/specs/2026-09-09-marketing-en-design.md`

## Global Constraints

- **Nessuna dipendenza npm nuova.** Solo `fs`/`path` di Node. `package.json` `dependencies`/`devDependencies` invariati (salvo lo script `verify:marketing`).
- **Indentazione: tab, non spazi** in tutti i file (`.mjs`, `.json`, `.html`) — convenzione del repo.
- **Base URL:** `https://joint-tracker.vercel.app` (nessuna slash finale). Definita una sola volta in `routes.json` come `baseUrl`.
- **Slug EN congelati** (una volta indicizzati non si cambiano senza redirect 308):
  `` (home) · `how-it-works` · `faq` · `blog` · `blog/what-is-a-tolerance-break` · `blog/how-to-cut-down-cannabis-use` · `blog/why-keep-a-consumption-diary`.
- **`x-default` → sempre la versione IT.** Nessun redirect automatico per lingua in nessun punto.
- **Testo utente-visibile IT: estratto verbatim** dagli HTML attuali nei fragment `content/it/**` (nessuna riscrittura).
- **`<html lang>`** = `it` sulle pagine IT, `en` su quelle EN.
- **Un solo blocco `<script type="application/ld+json">` per pagina**, dentro il fragment di contenuto.
- **Ordine di sostituzione dei placeholder nel layout: sempre via callback di `String.replace`** (`.replace(tok, () => value)`), mai stringa diretta — il contenuto può contenere `$&`, `$1`, `$$`.
- **`/app` e `/admin` non si toccano** e devono continuare a risolvere dopo il passaggio a `cleanUrls`.

---

## File Structure

**Nuovi sorgenti:**

| File | Responsabilità |
|---|---|
| `marketing/routes.json` | Fonte di verità: `baseUrl` + array `pages` (chiave, shell, ogType, changefreq, priority, headExtra, dir, metadati it/en) |
| `marketing/layout.html` | Guscio HTML con slot `{{LANG}} {{HEAD}} {{BANNER}} {{NAV}} {{MAIN}} {{FOOTER}} {{FOOT}}` |
| `marketing/partials/head-common.html` | `<head>` comune a tutte: favicon, theme-color, manifest, `mobile-web-app-capable`, `marketing.css` |
| `marketing/partials/head-home.html` | Solo home: preconnect Google Fonts + `Sora` + `landing.css` + redirect standalone→`/app` + `beforeinstallprompt`/`appinstalled` + registrazione SW + snippet Vercel Web Analytics |
| `marketing/partials/head-faq.html` | Solo FAQ: script che apre il `<details>` puntato da `location.hash` |
| `marketing/partials/nav.landing.{it,en}.html` | Nav in stile `.jt-nav` (solo home) |
| `marketing/partials/nav.site.{it,en}.html` | Nav in stile `.site-nav` (tutte le altre) |
| `marketing/partials/footer.landing.{it,en}.html` | Footer `.jt-footer` (solo home) |
| `marketing/partials/footer.site.{it,en}.html` | Footer `.site-footer` (tutte le altre) |
| `marketing/partials/lang-banner.html` | Markup + script inline del banner soft IT→EN |
| `marketing/content/it/*.html` | 7 fragment di contenuto IT, estratti verbatim |
| `marketing/content/en/*.html` | 7 fragment di contenuto EN (traduzioni) |
| `marketing/baseline/*.html` | Copia temporanea dei 7 HTML IT attuali per il parity check (rimossa nel Task 10) |
| `build-marketing.mjs` | `buildMarketing(outDir)`: monta le 14 pagine + genera `dist/sitemap.xml` |
| `verify-marketing.mjs` | Valida `dist/**` contro `routes.json`; exit 1 su violazione |
| `docs/superpowers/i18n-review-en.md` | Tabella IT ↔ bozza EN per la revisione di Matteo |

**Modificati:** `build.mjs` · `vercel.json` · `.claude/serve.json` · `package.json` · `CLAUDE.md` · `robots.txt` (invariato nei contenuti, verificato).

**Rimossi (sorgenti; l'output resta in `dist/`):** `index.html` · `come-funziona.html` · `faq.html` · `blog/index.html` · `blog/cose-una-tolerance-break.html` · `blog/come-ridurre-il-consumo-di-cannabis.html` · `blog/perche-tenere-un-diario-di-consumo.html` · `sitemap.xml`.

**Chiavi logiche delle pagine** (`page.key`, = path del fragment senza `.html`):
`home` · `how-it-works` · `faq` · `blog-index` · `blog/tolerance-break` · `blog/cut-down` · `blog/diary`.

---

## Task 1: `routes.json` + bootstrap `verify-marketing.mjs`

**Files:**
- Create: `marketing/routes.json`
- Create: `verify-marketing.mjs`
- Modify: `package.json` (aggiungi script)

**Interfaces:**
- Produces: `marketing/routes.json` con forma:
  ```
  { baseUrl: string, pages: Array<{
      key: string, shell: "landing"|"site", ogType: string,
      changefreq: string, priority: string,
      headExtra: string|null, dir?: true,
      it: { slug: string, title: string, description: string, ogTitle?: string, ogDescription?: string },
      en: { slug: string, title: string, description: string, ogTitle?: string, ogDescription?: string }
  }> }
  ```
  `slug` senza slash iniziale; `""` = root. `dir:true` solo per `blog-index` (emesso come `<slug>/index.html`).

- [ ] **Step 1: Crea `marketing/routes.json`**

I `title`/`description` IT sono copiati verbatim dai `<title>`/`<meta name=description>` attuali (vedi file elencati nella spec). I valori EN sono quelli qui sotto (congelati in questo piano).

```json
{
	"baseUrl": "https://joint-tracker.vercel.app",
	"pages": [
		{
			"key": "home",
			"shell": "landing",
			"ogType": "website",
			"changefreq": "weekly",
			"priority": "1.0",
			"headExtra": "head-home.html",
			"it": {
				"slug": "",
				"title": "JointTracker – Cannabis Tracker & Tolerance Break App",
				"description": "Traccia le tue sessioni, monitora le tolerance break e visualizza statistiche dettagliate sul consumo di cannabis. Track cannabis sessions, tolerance breaks and usage stats. App gratuita, funziona offline, dati privati.",
				"ogTitle": "JointTracker – Cannabis Tracker & Tolerance Break App",
				"ogDescription": "Traccia sessioni, tolerance break e statistiche sul consumo di cannabis. Gratis, privata, funziona offline."
			},
			"en": {
				"slug": "",
				"title": "JointTracker – Free Cannabis Tracker & Tolerance Break App",
				"description": "Track your cannabis sessions, monitor tolerance breaks and see detailed usage stats. Free, works offline, private by design.",
				"ogTitle": "JointTracker – Free Cannabis Tracker & Tolerance Break App",
				"ogDescription": "Track cannabis sessions, tolerance breaks and usage stats. Free, private, works offline."
			}
		},
		{
			"key": "how-it-works",
			"shell": "site",
			"ogType": "article",
			"changefreq": "monthly",
			"priority": "0.8",
			"headExtra": null,
			"it": {
				"slug": "come-funziona",
				"title": "Come funziona JointTracker – Guida al cannabis tracker",
				"description": "Scopri come funziona JointTracker: come registrare le sessioni, impostare una tolerance break, leggere le statistiche e usare l'app anche offline.",
				"ogTitle": "Come funziona JointTracker",
				"ogDescription": "Guida rapida a JointTracker: registro sessioni, tolerance break, statistiche e uso offline."
			},
			"en": {
				"slug": "how-it-works",
				"title": "How JointTracker Works – Cannabis Tracker Guide",
				"description": "How JointTracker works: logging sessions, starting a tolerance break, reading your stats and using the app offline.",
				"ogTitle": "How JointTracker Works",
				"ogDescription": "A quick guide to JointTracker: session log, tolerance breaks, stats and offline use."
			}
		},
		{
			"key": "faq",
			"shell": "site",
			"ogType": "website",
			"changefreq": "monthly",
			"priority": "0.8",
			"headExtra": "head-faq.html",
			"it": {
				"slug": "faq",
				"title": "FAQ JointTracker – Domande frequenti sul cannabis tracker",
				"description": "Le domande più frequenti su JointTracker: privacy dei dati, prezzo, funzionamento offline, tolerance break tracker e altro.",
				"ogTitle": "FAQ JointTracker",
				"ogDescription": "Le domande più frequenti su JointTracker: privacy, prezzo, offline, tolerance break."
			},
			"en": {
				"slug": "faq",
				"title": "JointTracker FAQ – Cannabis Tracker Questions",
				"description": "Common questions about JointTracker: data privacy, price, offline use, the tolerance break tracker and more.",
				"ogTitle": "JointTracker FAQ",
				"ogDescription": "Common questions about JointTracker: privacy, price, offline use, tolerance breaks."
			}
		},
		{
			"key": "blog-index",
			"shell": "site",
			"ogType": "website",
			"changefreq": "weekly",
			"priority": "0.7",
			"headExtra": null,
			"dir": true,
			"it": {
				"slug": "blog",
				"title": "Blog JointTracker – Articoli su cannabis, consumo e tolerance break",
				"description": "Articoli su tolerance break, riduzione del consumo di cannabis e uso consapevole. Dal blog di JointTracker, il cannabis tracker gratuito.",
				"ogTitle": "Blog JointTracker",
				"ogDescription": "Articoli su tolerance break, riduzione del consumo e uso consapevole della cannabis."
			},
			"en": {
				"slug": "blog",
				"title": "JointTracker Blog – Cannabis, Usage & Tolerance Breaks",
				"description": "Articles on tolerance breaks, cutting down on cannabis and mindful use. From the JointTracker blog, the free cannabis tracker.",
				"ogTitle": "JointTracker Blog",
				"ogDescription": "Articles on tolerance breaks, cutting down and mindful cannabis use."
			}
		},
		{
			"key": "blog/tolerance-break",
			"shell": "site",
			"ogType": "article",
			"changefreq": "monthly",
			"priority": "0.6",
			"headExtra": null,
			"it": {
				"slug": "blog/cose-una-tolerance-break",
				"title": "Cos'è una tolerance break e perché farla | Blog JointTracker",
				"description": "Cosa succede alla tolleranza con l'uso regolare di cannabis, quanto dura una tolerance break efficace e come pianificarla e monitorarla.",
				"ogTitle": "Cos'è una tolerance break e perché farla",
				"ogDescription": "Cosa succede alla tolleranza con l'uso regolare di cannabis e come pianificare una t-break efficace."
			},
			"en": {
				"slug": "blog/what-is-a-tolerance-break",
				"title": "What Is a Tolerance Break and Why Take One | JointTracker Blog",
				"description": "What happens to tolerance with regular cannabis use, how long an effective tolerance break lasts, and how to plan and track one.",
				"ogTitle": "What Is a Tolerance Break and Why Take One",
				"ogDescription": "What happens to tolerance with regular cannabis use and how to plan an effective t-break."
			}
		},
		{
			"key": "blog/cut-down",
			"shell": "site",
			"ogType": "article",
			"changefreq": "monthly",
			"priority": "0.6",
			"headExtra": null,
			"it": {
				"slug": "blog/come-ridurre-il-consumo-di-cannabis",
				"title": "Come ridurre il consumo di cannabis: guida pratica | Blog JointTracker",
				"description": "Strategie concrete per ridurre gradualmente il consumo di cannabis, con l'aiuto di un diario e obiettivi realistici.",
				"ogTitle": "Come ridurre il consumo di cannabis: guida pratica",
				"ogDescription": "Strategie concrete per ridurre gradualmente il consumo, con l'aiuto di un diario e obiettivi realistici."
			},
			"en": {
				"slug": "blog/how-to-cut-down-cannabis-use",
				"title": "How to Cut Down on Cannabis Use: A Practical Guide | JointTracker Blog",
				"description": "Concrete strategies to gradually reduce your cannabis use, with the help of a diary and realistic goals.",
				"ogTitle": "How to Cut Down on Cannabis Use: A Practical Guide",
				"ogDescription": "Concrete strategies to gradually reduce use, with the help of a diary and realistic goals."
			}
		},
		{
			"key": "blog/diary",
			"shell": "site",
			"ogType": "article",
			"changefreq": "monthly",
			"priority": "0.6",
			"headExtra": null,
			"it": {
				"slug": "blog/perche-tenere-un-diario-di-consumo",
				"title": "Perché tenere un diario di consumo cambia le cose | Blog JointTracker",
				"description": "La differenza tra abitudini percepite e abitudini reali, e perché i dati aiutano a decidere meglio.",
				"ogTitle": "Perché tenere un diario di consumo cambia le cose",
				"ogDescription": "La differenza tra abitudini percepite e abitudini reali, e perché i dati aiutano a decidere meglio."
			},
			"en": {
				"slug": "blog/why-keep-a-consumption-diary",
				"title": "Why Keeping a Consumption Diary Changes Things | JointTracker Blog",
				"description": "The gap between perceived and real habits, and why objective data helps you make better decisions.",
				"ogTitle": "Why Keeping a Consumption Diary Changes Things",
				"ogDescription": "The gap between perceived and real habits, and why data helps you decide better."
			}
		}
	]
}
```

- [ ] **Step 2: Crea `verify-marketing.mjs` (versione bootstrap — solo `routes.json`)**

```js
// Valida marketing/routes.json (Task 1). Dal Task 3 in poi valida anche dist/.
import { readFileSync } from 'fs';

const routes = JSON.parse(readFileSync('marketing/routes.json', 'utf8'));
const errs = [];
const seen = new Set();

if (!/^https:\/\/[^/]+$/.test(routes.baseUrl)) errs.push(`baseUrl malformato: ${routes.baseUrl}`);
if (!Array.isArray(routes.pages) || routes.pages.length !== 7) errs.push(`atteso 7 pages, trovato ${routes.pages?.length}`);

for (const p of routes.pages) {
	for (const f of ['key', 'shell', 'ogType', 'changefreq', 'priority']) {
		if (!p[f]) errs.push(`${p.key}: campo mancante "${f}"`);
	}
	if (!['landing', 'site'].includes(p.shell)) errs.push(`${p.key}: shell non valida "${p.shell}"`);
	for (const loc of ['it', 'en']) {
		const m = p[loc];
		if (!m || typeof m.slug !== 'string') { errs.push(`${p.key}.${loc}: slug mancante`); continue; }
		if (!m.title || !m.description) errs.push(`${p.key}.${loc}: title/description mancante`);
		const dup = `${loc}:${m.slug}`;
		if (seen.has(dup)) errs.push(`slug duplicato: ${dup}`);
		seen.add(dup);
	}
}

if (errs.length) { console.error('verify-marketing FAIL:\n' + errs.map(e => '  - ' + e).join('\n')); process.exit(1); }
console.log('verify-marketing OK (routes.json)');
```

- [ ] **Step 3: Aggiungi lo script a `package.json`**

```json
	"scripts": {
		"build": "node build.mjs",
		"verify:marketing": "node verify-marketing.mjs"
	}
```

- [ ] **Step 4: Esegui la verifica**

Run: `npm run verify:marketing`
Expected: `verify-marketing OK (routes.json)`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add marketing/routes.json verify-marketing.mjs package.json
git commit -m "feat(marketing): route map + verify harness for bilingual site"
```

---

## Task 2: Estrai i fragment IT, i partial e il layout

Nessuna logica nuova: il deliverable sono i file sorgente, verificati dal Task 3. Tutto il testo IT è **copiato verbatim** dagli HTML attuali.

**Files:**
- Create: `marketing/baseline/{index,come-funziona,faq}.html` + `marketing/baseline/blog/{index,cose-una-tolerance-break,come-ridurre-il-consumo-di-cannabis,perche-tenere-un-diario-di-consumo}.html` (copie 1:1 degli attuali)
- Create: `marketing/layout.html`
- Create: `marketing/partials/head-common.html`, `head-home.html`, `head-faq.html`
- Create: `marketing/partials/nav.landing.it.html`, `nav.site.it.html`, `footer.landing.it.html`, `footer.site.it.html`
- Create: `marketing/content/it/home.html`, `how-it-works.html`, `faq.html`, `blog-index.html`, `blog/tolerance-break.html`, `blog/cut-down.html`, `blog/diary.html`

- [ ] **Step 1: Copia i 7 HTML attuali in `marketing/baseline/` (parity reference)**

```bash
mkdir -p marketing/baseline/blog
cp index.html marketing/baseline/index.html
cp come-funziona.html marketing/baseline/come-funziona.html
cp faq.html marketing/baseline/faq.html
cp blog/index.html marketing/baseline/blog/index.html
cp blog/cose-una-tolerance-break.html marketing/baseline/blog/cose-una-tolerance-break.html
cp blog/come-ridurre-il-consumo-di-cannabis.html marketing/baseline/blog/come-ridurre-il-consumo-di-cannabis.html
cp blog/perche-tenere-un-diario-di-consumo.html marketing/baseline/blog/perche-tenere-un-diario-di-consumo.html
```

- [ ] **Step 2: Crea `marketing/layout.html`**

```html
<!DOCTYPE html>
<html lang="{{LANG}}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
{{HEAD}}
</head>
<body>
{{BANNER}}
{{NAV}}
{{MAIN}}
{{FOOTER}}
{{FOOT}}
</body>
</html>
```

- [ ] **Step 3: Crea `marketing/partials/head-common.html`**

Estratto dai `<link rel=icon…>` + theme-color + manifest comuni a tutte le pagine attuali. NB: `marketing.css` è incluso qui per **tutte**; la home aggiunge `landing.css` dopo (in `head-home.html`) e le sue regole vincono per specificità/ordine come oggi.

```html
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c120c">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f7f6">
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=2">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=2">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
<link rel="manifest" href="/manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<link rel="preload" href="/marketing.css" as="style">
<link rel="stylesheet" href="/marketing.css">
```

- [ ] **Step 4: Crea `marketing/partials/head-home.html`**

Estratto verbatim dagli script e `<link>` che oggi stanno solo in `index.html` (`<head>`): `google-site-verification`, preconnect + font Sora, `landing.css`, redirect standalone→`/app`, `beforeinstallprompt`/`appinstalled` + click `#installBtn`, registrazione SW, snippet Vercel Web Analytics (`window.va` + `/_vercel/insights/script.js`). Copiare dal file attuale `index.html` righe 4 e 34–111 (adattando: niente `<title>`/`<meta description>`/canonical/og — quelli li genera il build).

```html
<meta name="google-site-verification" content="FjvZpRN13XyjFacmmelH4SajsY6uXV7nhszCzV2g5FA" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/landing.css">
<script>
(function () {
	try {
		var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
		if (standalone) window.location.replace('/app');
	} catch (e) {}
})();
</script>
<script>
(function () {
	var deferredPrompt = null;
	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();
		deferredPrompt = e;
		var row = document.getElementById('installRow');
		var hint = document.getElementById('installHint');
		if (row) row.style.display = 'flex';
		if (hint) hint.style.display = 'none';
	});
	window.addEventListener('appinstalled', function () {
		deferredPrompt = null;
		var row = document.getElementById('installRow');
		if (row) row.style.display = 'none';
	});
	document.addEventListener('DOMContentLoaded', function () {
		var btn = document.getElementById('installBtn');
		if (btn) btn.addEventListener('click', async function () {
			if (!deferredPrompt) return;
			deferredPrompt.prompt();
			await deferredPrompt.userChoice;
			deferredPrompt = null;
			var row = document.getElementById('installRow');
			if (row) row.style.display = 'none';
		});
	});
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js').catch(function () {});
	}
})();
</script>
<script>
	window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
```

- [ ] **Step 5: Crea `marketing/partials/head-faq.html`** (verbatim da `faq.html` righe 29–42)

```html
<script>
// <details> non si apre da solo seguendo un link con #hash: lo forziamo qui,
// altrimenti chi arriva da un link diretto (es. dalla landing) vede solo la
// domanda chiusa senza la risposta.
if (location.hash) {
	document.addEventListener('DOMContentLoaded', function () {
		const el = document.querySelector(location.hash);
		if (el && el.tagName === 'DETAILS') {
			el.open = true;
			el.scrollIntoView();
		}
	});
}
</script>
```

- [ ] **Step 6: Crea i partial nav/footer IT**

`marketing/partials/nav.site.it.html` — da `come-funziona.html` righe 31–41, con l'aggiunta del segnaposto switcher `{{ALT_URL}}` (lo stile arriva nel Task 8; per ora è un `<a>` semplice):

```html
<nav class="site-nav">
	<div class="container">
		<a href="/" class="brand"><svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true" style="flex:0 0 auto"><path d="M14.68 42 A20 20 0 1 1 49.32 42" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="5.6" stroke-linecap="round"/><path d="M14.68 42 A20 20 0 0 1 43.76 15.82" fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/><g transform="rotate(-54 32 32)"><path d="M14 27.8 L52 24.6 L52 39.4 L14 36.2 Z" fill="currentColor"/><ellipse cx="52" cy="32" rx="2.9" ry="7.6" fill="currentColor"/></g></svg>JointTracker</a>
		<div class="nav-links">
			<a href="/come-funziona">Come funziona</a>
			<a href="/faq">FAQ</a>
			<a href="/blog">Blog</a>
			<a href="/app" class="nav-cta">Apri l'app</a>
			<a href="{{ALT_URL}}" class="nav-lang" hreflang="en" lang="en">EN</a>
		</div>
	</div>
</nav>
```

`marketing/partials/footer.site.it.html` — da `come-funziona.html` righe 76–84:

```html
<footer class="site-footer">
	<nav>
		<a href="/come-funziona">Come funziona</a>
		<a href="/faq">FAQ</a>
		<a href="/blog">Blog</a>
		<a href="/app">Apri l'app</a>
		<a href="{{ALT_URL}}" class="footer-lang" hreflang="en" lang="en">English</a>
	</nav>
	<p>JointTracker — cannabis tracker gratuito e privato.</p>
</footer>
```

`marketing/partials/nav.landing.it.html` — da `index.html` righe 140–163 (il `<nav class="jt-nav">` completo di brand SVG), aggiungendo nella `.jt-nav__links`:

```html
			<a href="{{ALT_URL}}" class="jt-btn jt-btn--sm jt-btn--ghost" hreflang="en" lang="en">EN</a>
```
subito prima di `<a href="/app" class="jt-btn jt-btn--sm" data-i18n="nav.openApp">` — e **rimuovendo tutti gli attributi `data-i18n`** dai link nav (sono inerti). Testo dei link invariato.

`marketing/partials/footer.landing.it.html` — da `index.html` righe 262–270, senza `data-i18n`, con in coda alla lista link:

```html
			<a href="{{ALT_URL}}" class="jt-lang-link" hreflang="en" lang="en">English</a>
```

- [ ] **Step 7: Crea i fragment `marketing/content/it/*.html`**

Ogni fragment = **tutto ciò che oggi sta tra `</nav>` e `<footer>`** del file corrispondente (il blocco `<header>`/`<section>`/`<main>`/`<article>` + eventuali `<svg class="jt-defs">` e `<div class="jt-glow">` per la home), **più** il blocco `<script type="application/ld+json">` che oggi sta nel `<head>` (spostato in fondo al fragment).

| Fragment | Sorgente | Note |
|---|---|---|
| `content/it/home.html` | `index.html` righe 115–271 (`<div class="jt-page">` … `</div>` **escluso** nav e footer → in realtà: le `jt-glow`, `jt-defs`, `<header class=jt-hero>`, le `<section>`, **senza** `<nav>`/`<footer>`), + JSON-LD `WebApplication` da righe 51–68 in coda. **Rimuovi ogni `data-i18n`/`data-i18n-html`.** Mantieni gli `id` (`installRow`, `installBtn`, `installHint`) — servono a `head-home.html`. Mantieni i blocchi `window.si`/speed-insights? No: quelli vanno nel layout `{{FOOT}}` (Task 3). Rimuovili dal fragment. |
| `content/it/how-it-works.html` | `come-funziona.html` righe 43–74 (`<article class="post">…</article>`) | nessun JSON-LD |
| `content/it/faq.html` | `faq.html` righe 131–178 (`<main>…</main>`) + JSON-LD `FAQPage` righe 44–115 in coda | mantieni `id="installazione"` |
| `content/it/blog-index.html` | `blog/index.html` righe 43–73 (`<main>…</main>`) | nessun JSON-LD |
| `content/it/blog/tolerance-break.html` | `blog/cose-una-tolerance-break.html` righe 55–80 (`<article>`) + JSON-LD `Article` righe 29–39 in coda | |
| `content/it/blog/cut-down.html` | `blog/come-ridurre-il-consumo-di-cannabis.html` `<article>` + JSON-LD `Article` in coda | |
| `content/it/blog/diary.html` | `blog/perche-tenere-un-diario-di-consumo.html` `<article>` + JSON-LD `Article` in coda | |

Il JSON-LD resta identico all'attuale (URL assoluti già presenti). Non modificare il testo.

- [ ] **Step 8: Commit**

```bash
git add marketing/
git commit -m "feat(marketing): extract IT content fragments, shared layout and partials"
```

---

## Task 3: `build-marketing.mjs` — render IT, aggancio a `build.mjs`, rimozione vecchi file

**Files:**
- Create: `build-marketing.mjs`
- Modify: `build.mjs` (chiama `buildMarketing()`, sfoltisce `STATIC_ENTRIES`)
- Modify: `verify-marketing.mjs` (sostituzione completa — ora valida `dist/`)
- Delete: `index.html`, `come-funziona.html`, `faq.html`, `blog/index.html`, `blog/cose-una-tolerance-break.html`, `blog/come-ridurre-il-consumo-di-cannabis.html`, `blog/perche-tenere-un-diario-di-consumo.html`

**Interfaces:**
- Produces: `export function buildMarketing(outDir = 'dist'): string[]` — scrive `outDir/**` per le 14 pagine + `outDir/sitemap.xml`, ritorna i path scritti.
- Produces (interni, usati anche da `verify-marketing.mjs` via re-import): `export function urlFor(page, loc): string`, `export function outPathFor(page, loc): string`, `export const routes`.
- Consumes: `marketing/routes.json`, `marketing/layout.html`, `marketing/partials/*`, `marketing/content/{it,en}/*` (i fragment `en/` **non esistono ancora**: vedi Step 3).

- [ ] **Step 1: Scrivi `build-marketing.mjs`**

```js
// Monta le pagine marketing IT/EN da marketing/** dentro dist/**, una per lingua,
// e genera dist/sitemap.xml. Chiamato da build.mjs. Nessuna dipendenza esterna.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const M = 'marketing';
export const routes = JSON.parse(readFileSync(`${M}/routes.json`, 'utf8'));
const layout = readFileSync(`${M}/layout.html`, 'utf8');
const partialCache = new Map();
const partial = (name) => {
	if (!partialCache.has(name)) partialCache.set(name, readFileSync(`${M}/partials/${name}`, 'utf8').trim());
	return partialCache.get(name);
};

const LOCALES = ['it', 'en'];
const OG_LOCALE = { it: 'it_IT', en: 'en_US' };
const other = (loc) => (loc === 'it' ? 'en' : 'it');

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const put = (tpl, token, value) => tpl.replace(token, () => value); // callback: mai interpretare $ nel value

export function urlFor(page, loc) {
	const slug = page[loc].slug;
	if (loc === 'it') return routes.baseUrl + (slug ? `/${slug}` : '/');
	return routes.baseUrl + (slug ? `/en/${slug}` : '/en/');
}

export function outPathFor(page, loc) {
	const slug = page[loc].slug;
	const base = loc === 'it' ? '' : 'en/';
	if (!slug) return `${base}index.html`;
	if (page.dir) return `${base}${slug}/index.html`;
	return `${base}${slug}.html`;
}

function headFor(page, loc) {
	const m = page[loc];
	const canonical = urlFor(page, loc);
	const itUrl = urlFor(page, 'it');
	const enUrl = urlFor(page, 'en');
	const ogImg = routes.baseUrl + '/og-image.png';
	const ogTitle = m.ogTitle || m.title;
	const ogDesc = m.ogDescription || m.description;
	const out = [
		`<title>${escAttr(m.title)}</title>`,
		`<meta name="description" content="${escAttr(m.description)}">`,
		`<link rel="canonical" href="${canonical}">`,
		`<link rel="alternate" hreflang="it" href="${itUrl}">`,
		`<link rel="alternate" hreflang="en" href="${enUrl}">`,
		`<link rel="alternate" hreflang="x-default" href="${itUrl}">`,
		`<meta property="og:title" content="${escAttr(ogTitle)}">`,
		`<meta property="og:description" content="${escAttr(ogDesc)}">`,
		`<meta property="og:image" content="${ogImg}">`,
		`<meta property="og:url" content="${canonical}">`,
		`<meta property="og:type" content="${page.ogType}">`,
		`<meta property="og:locale" content="${OG_LOCALE[loc]}">`,
		`<meta property="og:locale:alternate" content="${OG_LOCALE[other(loc)]}">`,
		`<meta name="twitter:card" content="summary_large_image">`,
		`<meta name="twitter:title" content="${escAttr(ogTitle)}">`,
		`<meta name="twitter:description" content="${escAttr(ogDesc)}">`,
		`<meta name="twitter:image" content="${ogImg}">`,
		partial('head-common.html'),
	];
	if (page.headExtra) out.push(partial(page.headExtra));
	return out.join('\n');
}

// Nei fragment EN gli href interni sono scritti come path IT (i traduttori toccano
// solo il testo): qui li rimappo alle controparti EN. /app e ancore # preservati.
function localizeLinks(html, loc) {
	if (loc === 'it') return html;
	const map = new Map();
	for (const p of routes.pages) {
		const it = p.it.slug ? `/${p.it.slug}` : '/';
		const en = p.en.slug ? `/en/${p.en.slug}` : '/en/';
		map.set(it, en);
	}
	return html.replace(/href="(\/[a-z0-9\-/]*)(#[^"]*)?"/gi, (mtch, path, hash = '') => {
		if (path === '/app' || path.startsWith('/app/')) return mtch;
		const en = map.get(path);
		return en ? `href="${en}${hash || ''}"` : mtch;
	});
}

const FOOT = [
	`<script>window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)};</script>`,
	`<script defer src="/_vercel/speed-insights/script.js"></script>`,
].join('\n');

function render(page, loc) {
	const frag = localizeLinks(readFileSync(`${M}/content/${loc}/${page.key}.html`, 'utf8').trim(), loc);
	const alt = urlFor(page, other(loc));
	const nav = put(partial(`nav.${page.shell}.${loc}.html`), '{{ALT_URL}}', alt).replaceAll('{{ALT_URL}}', alt);
	const footer = partial(`footer.${page.shell}.${loc}.html`).replaceAll('{{ALT_URL}}', alt);
	const banner = loc === 'it' ? partial('lang-banner.html').replaceAll('{{ALT_URL}}', alt) : '';
	let doc = put(layout, '{{LANG}}', loc);
	doc = put(doc, '{{HEAD}}', headFor(page, loc));
	doc = put(doc, '{{BANNER}}', banner);
	doc = put(doc, '{{NAV}}', nav);
	doc = put(doc, '{{MAIN}}', frag);
	doc = put(doc, '{{FOOTER}}', footer);
	doc = put(doc, '{{FOOT}}', FOOT);
	return doc;
}

function writeSitemap(outDir) {
	const rows = [];
	for (const page of routes.pages) {
		for (const loc of LOCALES) {
			const alts = [
				`    <xhtml:link rel="alternate" hreflang="it" href="${urlFor(page, 'it')}"/>`,
				`    <xhtml:link rel="alternate" hreflang="en" href="${urlFor(page, 'en')}"/>`,
				`    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor(page, 'it')}"/>`,
			].join('\n');
			rows.push(`  <url>\n    <loc>${urlFor(page, loc)}</loc>\n${alts}\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`);
		}
	}
	writeSitemap._xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
	writeFileSync(join(outDir, 'sitemap.xml'), writeSitemap._xml);
}

export function buildMarketing(outDir = 'dist') {
	const written = [];
	for (const page of routes.pages) {
		for (const loc of LOCALES) {
			const out = join(outDir, outPathFor(page, loc));
			mkdirSync(dirname(out), { recursive: true });
			writeFileSync(out, render(page, loc));
			written.push(out);
		}
	}
	writeSitemap(outDir);
	console.log(`Marketing: ${written.length} pagine + sitemap.xml in ${outDir}/`);
	return written;
}
```

> NB: `marketing/partials/lang-banner.html` è creato nel Task 9. Per far girare i Task 3–8 crealo **ora come file vuoto**: `printf '' > marketing/partials/lang-banner.html` (il banner reale arriva nel Task 9). Su locale IT senza banner la pagina è comunque valida.

- [ ] **Step 2: Crea il placeholder vuoto del banner**

```bash
printf '' > marketing/partials/lang-banner.html
```

- [ ] **Step 3: Crea fragment EN provvisori = copia degli IT (verranno tradotti nei Task 6–7)**

Serve solo perché `buildMarketing` legge `content/en/*`. Verranno sovrascritti.

```bash
mkdir -p marketing/content/en/blog
for f in home how-it-works faq blog-index; do cp "marketing/content/it/$f.html" "marketing/content/en/$f.html"; done
for f in tolerance-break cut-down diary; do cp "marketing/content/it/blog/$f.html" "marketing/content/en/blog/$f.html"; done
```

- [ ] **Step 4: Aggiorna `build.mjs`**

Modifica 1 — import in cima (dopo gli altri import):

```js
import { buildMarketing } from './build-marketing.mjs';
```

Modifica 2 — in `STATIC_ENTRIES` **rimuovi** `'sitemap.xml'`, `'index.html'`, `'come-funziona.html'`, `'faq.html'`, `'blog'`. Il commento sopra l'array va aggiornato di conseguenza. Risultato:

```js
const STATIC_ENTRIES = [
	'manifest.json', 'robots.txt',
	'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png',
	'icon-192.png', 'icon-384.png', 'icon-512.png', 'icon-1024.png',
	'icon-maskable-192.png', 'icon-maskable-384.png', 'icon-maskable-512.png', 'icon-maskable-1024.png',
	'locales', 'splash', 'img',
	// CSS marketing (non hashati) + og-image + admin. Le PAGINE marketing non sono
	// piu' qui: le genera build-marketing.mjs da marketing/** (vedi sotto).
	'marketing.css', 'landing.css', 'og-image.png',
	'admin.html'
];
```

Modifica 3 — in fondo al file, prima del `console.log` finale:

```js
buildMarketing(OUT);
```

- [ ] **Step 5: Sostituisci `verify-marketing.mjs` con la versione che valida `dist/`**

```js
// Valida marketing/routes.json e l'output in dist/ dopo `node build.mjs`.
// Exit 1 su qualsiasi violazione. Esegui: npm run verify:marketing
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { routes, urlFor, outPathFor } from './build-marketing.mjs';

const OUT = 'dist';
const errs = [];
const LOCALES = ['it', 'en'];
const fail = (m) => errs.push(m);

// --- routes.json ---
if (!/^https:\/\/[^/]+$/.test(routes.baseUrl)) fail(`baseUrl malformato: ${routes.baseUrl}`);
if (routes.pages.length !== 7) fail(`atteso 7 pages, trovato ${routes.pages.length}`);
{
	const seen = new Set();
	for (const p of routes.pages) for (const loc of LOCALES) {
		const k = `${loc}:${p[loc].slug}`;
		if (seen.has(k)) fail(`slug duplicato: ${k}`);
		seen.add(k);
	}
}

// --- pagine renderizzate ---
const pages = [];
for (const p of routes.pages) for (const loc of LOCALES) {
	const path = join(OUT, outPathFor(p, loc));
	if (!existsSync(path)) { fail(`file mancante: ${path}`); continue; }
	pages.push({ p, loc, path, html: readFileSync(path, 'utf8') });
}

for (const { p, loc, path, html } of pages) {
	const url = urlFor(p, loc);
	const itUrl = urlFor(p, 'it');
	const enUrl = urlFor(p, 'en');

	// C1 lang
	const langM = html.match(/<html lang="([^"]+)"/);
	if (!langM || langM[1] !== loc) fail(`${path}: <html lang> atteso "${loc}", trovato "${langM?.[1]}"`);

	// C2 canonical = self
	if (!html.includes(`<link rel="canonical" href="${url}">`)) fail(`${path}: canonical != self (${url})`);

	// C3 hreflang trio
	for (const [hl, href] of [['it', itUrl], ['en', enUrl], ['x-default', itUrl]]) {
		if (!html.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`)) fail(`${path}: hreflang ${hl} -> ${href} mancante`);
	}

	// C4 og:locale
	const ogl = loc === 'it' ? 'it_IT' : 'en_US';
	const ogla = loc === 'it' ? 'en_US' : 'it_IT';
	if (!html.includes(`<meta property="og:locale" content="${ogl}">`)) fail(`${path}: og:locale != ${ogl}`);
	if (!html.includes(`<meta property="og:locale:alternate" content="${ogla}">`)) fail(`${path}: og:locale:alternate != ${ogla}`);

	// C5 esattamente 1 JSON-LD valido (se presente)
	const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
	if (ld.length > 1) fail(`${path}: ${ld.length} blocchi JSON-LD (atteso 0 o 1)`);
	for (const m of ld) { try { JSON.parse(m[1]); } catch { fail(`${path}: JSON-LD non valido`); } }

	// C6 nessun placeholder / attributo morto residuo
	if (html.includes('{{')) fail(`${path}: placeholder {{...}} non risolto`);
	if (html.includes('data-i18n')) fail(`${path}: attributo data-i18n residuo`);

	// C7 nessun link interno IT nelle pagine EN (localizeLinks mancato)
	if (loc === 'en') {
		for (const bad of ['href="/come-funziona"', 'href="/faq"', 'href="/blog"', 'href="/"']) {
			if (html.includes(bad)) fail(`${path}: link IT non localizzato (${bad})`);
		}
	}
}

// C8 reciprocita hreflang: la controparte esiste come file
for (const { p, loc, path } of pages) {
	const otherLoc = loc === 'it' ? 'en' : 'it';
	const counterpart = join(OUT, outPathFor(p, otherLoc));
	if (!existsSync(counterpart)) fail(`${path}: controparte ${otherLoc} mancante (${counterpart})`);
}

// C9 sitemap
if (!existsSync(join(OUT, 'sitemap.xml'))) fail('dist/sitemap.xml mancante');
else {
	const xml = readFileSync(join(OUT, 'sitemap.xml'), 'utf8');
	const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
	if (locs.length !== 14) fail(`sitemap: ${locs.length} <loc> (atteso 14)`);
	for (const p of routes.pages) for (const loc of LOCALES) {
		if (!locs.includes(urlFor(p, loc))) fail(`sitemap: manca ${urlFor(p, loc)}`);
	}
	const alts = [...xml.matchAll(/<xhtml:link /g)].length;
	if (alts !== 42) fail(`sitemap: ${alts} xhtml:link (atteso 42 = 14 url x 3)`);
}

if (errs.length) { console.error(`verify-marketing FAIL (${errs.length}):\n` + errs.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log(`verify-marketing OK — ${pages.length} pagine, sitemap 14 url`);
```

- [ ] **Step 6: Esegui build + verify, aspettati il fallimento su C5 (2 JSON-LD sulle EN)**

Run: `node build.mjs && npm run verify:marketing`
Expected: **FAIL** — le pagine EN sono copie IT e alcune hanno il JSON-LD duplicato? No: il fragment ne ha 1. Il fallimento atteso qui è invece **C7** (`href="/come-funziona"` ecc. nelle EN, perché `localizeLinks` rimappa ma i fragment EN provvisori = IT e i link vengono rimappati correttamente…).
In pratica: se `localizeLinks` funziona, C7 passa. L'unico fallimento atteso a questo punto è che le pagine EN sono in italiano — **non rilevabile da verify** (verify non giudica la lingua del testo). Quindi:
Expected: **PASS** — `verify-marketing OK — 14 pagine, sitemap 14 url`.

Se fallisce, correggi finché non passa.

- [ ] **Step 7: Parity check IT — l'output IT non è cambiato nel contenuto**

Crea `marketing/parity-check.mjs`:

```js
// Confronta il testo visibile delle pagine IT renderizzate con le copie in
// marketing/baseline/. Deve combaciare (modulo nav/footer/switcher/whitespace).
import { readFileSync } from 'fs';
import { routes, outPathFor } from './build-marketing.mjs';

const strip = (h) => h
	.replace(/<script[\s\S]*?<\/script>/g, ' ')
	.replace(/<style[\s\S]*?<\/style>/g, ' ')
	.replace(/<svg[\s\S]*?<\/svg>/g, ' ')
	.replace(/<[^>]+>/g, ' ')
	.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

// token introdotti dal nuovo guscio, da ignorare nel confronto
const NOISE = ['EN', 'English', 'This page is also available in English'];
const clean = (s) => { for (const n of NOISE) s = s.split(n).join(''); return s.replace(/\s+/g, ' ').trim(); };

const BASE = {
	home: 'index.html', 'how-it-works': 'come-funziona.html', faq: 'faq.html',
	'blog-index': 'blog/index.html',
	'blog/tolerance-break': 'blog/cose-una-tolerance-break.html',
	'blog/cut-down': 'blog/come-ridurre-il-consumo-di-cannabis.html',
	'blog/diary': 'blog/perche-tenere-un-diario-di-consumo.html',
};

let bad = 0;
for (const p of routes.pages) {
	const rendered = clean(strip(readFileSync('dist/' + outPathFor(p, 'it'), 'utf8')));
	const baseline = clean(strip(readFileSync('marketing/baseline/' + BASE[p.key], 'utf8')));
	if (rendered !== baseline) {
		bad++;
		console.error(`PARITY DIFF: ${p.key}`);
		// mostra il primo punto di divergenza
		let i = 0; while (i < rendered.length && rendered[i] === baseline[i]) i++;
		console.error(`  rendered: …${rendered.slice(Math.max(0, i - 40), i + 40)}…`);
		console.error(`  baseline: …${baseline.slice(Math.max(0, i - 40), i + 40)}…`);
	}
}
if (bad) process.exit(1);
console.log('parity OK — testo IT invariato su 7 pagine');
```

Run: `node parity-check.mjs` (dalla cartella `marketing/`… no: dalla root, path già relativi) → `node marketing/parity-check.mjs`
Expected: `parity OK — testo IT invariato su 7 pagine`.
Se ci sono diff legittime (es. una parola davvero spostata), documentale nel commit; se sono regressioni, correggi il fragment.

- [ ] **Step 8: Elimina i vecchi file sorgente**

```bash
git rm index.html come-funziona.html faq.html blog/index.html blog/cose-una-tolerance-break.html blog/come-ridurre-il-consumo-di-cannabis.html blog/perche-tenere-un-diario-di-consumo.html sitemap.xml
```

- [ ] **Step 9: Rebuild + verify + parity da pulito**

```bash
rm -rf dist && node build.mjs && npm run verify:marketing && node marketing/parity-check.mjs
```
Expected: build OK, `verify-marketing OK — 14 pagine`, `parity OK`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(marketing): render IT+EN pages via build-marketing.mjs, drop top-level HTML"
```

---

## Task 4: Blocca `verify` nella build e valida i metadati per-pagina

**Files:**
- Modify: `package.json` (`build` esegue anche `verify`)
- Modify: `verify-marketing.mjs` (aggiunge check title/description da `routes.json`)

**Interfaces:**
- Consumes: `routes`, `urlFor`, `outPathFor` da `build-marketing.mjs`.

- [ ] **Step 1: Aggiungi il check title/description in `verify-marketing.mjs`**

Dentro il loop `for (const { p, loc, path, html } of pages)`, dopo il check C4:

```js
	// C4b title/description = routes.json
	const m = p[loc];
	if (!html.includes(`<title>${m.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`)) fail(`${path}: <title> != routes.json`);
	const descEsc = m.description.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	if (!html.includes(`<meta name="description" content="${descEsc}">`)) fail(`${path}: description != routes.json`);
```

- [ ] **Step 2: Concatena `verify` alla `build` in `package.json`**

```json
	"scripts": {
		"build": "node build.mjs && node verify-marketing.mjs",
		"verify:marketing": "node verify-marketing.mjs"
	}
```

(Vercel esegue `npm run build` → una `verify` fallita blocca il deploy: è voluto.)

- [ ] **Step 3: Esegui**

Run: `rm -rf dist && npm run build`
Expected: build + `verify-marketing OK — 14 pagine, sitemap 14 url`, exit 0.

- [ ] **Step 4: Prova negativa (facoltativa ma consigliata)**

Modifica temporaneamente un `title` in `routes.json`, `npm run build` → deve fallire con `<title> != routes.json`. Ripristina.

- [ ] **Step 5: Commit**

```bash
git add package.json verify-marketing.mjs
git commit -m "build(marketing): run verify-marketing as part of npm build; check per-page meta"
```

---

## Task 5: Traduzione EN — home, come funziona, FAQ

**Files:**
- Overwrite: `marketing/content/en/home.html`, `marketing/content/en/how-it-works.html`, `marketing/content/en/faq.html`
- Create: `marketing/partials/nav.landing.en.html`, `nav.site.en.html`, `footer.landing.en.html`, `footer.site.en.html`
- Create: `docs/superpowers/i18n-review-en.md` (sezione pagine)

**Interfaces:**
- Consumes: struttura dei fragment IT corrispondenti (stessi tag/classi/`id`, solo testo tradotto).

**Regole di traduzione (valgono anche per il Task 6):**
- Inglese naturale, non calco dall'italiano. Registro: informativo, senza giudizio, come l'originale.
- **Mantieni identici**: tutti i tag, le classi CSS, gli `id`, gli attributi, la struttura degli heading, gli `href` (restano path IT: `localizeLinks` li rimappa in build).
- **Non tradurre** `/app` né i nomi propri (JointTracker, Supabase, Chrome, Safari, iPhone, Android).
- Keyword SEO da preservare/usare dove naturale: *cannabis tracker*, *tolerance break tracker*, *weed diary / cannabis journal*, *cut down on cannabis*.
- Il blocco `<script type="application/ld+json">` va tradotto nei suoi valori testuali (`name`, `text`, `headline`, `description`), lasciando invariati chiavi, `@type`, URL.
- Unità/valute: lascia i grammi; nessuna conversione.

- [ ] **Step 1: Crea i partial nav/footer EN**

`nav.site.en.html` — come `nav.site.it.html` ma: link `Come funziona`→`How it works`, `Blog`→`Blog`, `Apri l'app`→`Open the app`, e lo switcher diventa `<a href="{{ALT_URL}}" class="nav-lang" hreflang="it" lang="it">IT</a>`. Gli `href` restano `/come-funziona` ecc. (in build questi partial NON passano da `localizeLinks`, quindi vanno scritti già con i path EN):

```html
<nav class="site-nav">
	<div class="container">
		<a href="/en/" class="brand"><svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true" style="flex:0 0 auto"><path d="M14.68 42 A20 20 0 1 1 49.32 42" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="5.6" stroke-linecap="round"/><path d="M14.68 42 A20 20 0 0 1 43.76 15.82" fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/><g transform="rotate(-54 32 32)"><path d="M14 27.8 L52 24.6 L52 39.4 L14 36.2 Z" fill="currentColor"/><ellipse cx="52" cy="32" rx="2.9" ry="7.6" fill="currentColor"/></g></svg>JointTracker</a>
		<div class="nav-links">
			<a href="/en/how-it-works">How it works</a>
			<a href="/en/faq">FAQ</a>
			<a href="/en/blog">Blog</a>
			<a href="/app" class="nav-cta">Open the app</a>
			<a href="{{ALT_URL}}" class="nav-lang" hreflang="it" lang="it">IT</a>
		</div>
	</div>
</nav>
```

`footer.site.en.html`:

```html
<footer class="site-footer">
	<nav>
		<a href="/en/how-it-works">How it works</a>
		<a href="/en/faq">FAQ</a>
		<a href="/en/blog">Blog</a>
		<a href="/app">Open the app</a>
		<a href="{{ALT_URL}}" class="footer-lang" hreflang="it" lang="it">Italiano</a>
	</nav>
	<p>JointTracker — a free, private cannabis tracker.</p>
</footer>
```

`nav.landing.en.html` / `footer.landing.en.html` — come le controparti `.it` (`.jt-nav` / `.jt-footer`), href già in versione `/en/…` (o `/en/` per il brand), testo tradotto: `Come funziona`→`How it works`, `Apri l'app`→`Open the app`, switcher `IT`. Footer tagline `JointTracker — cannabis tracker gratuito e privato.`→`JointTracker — a free, private cannabis tracker.`

- [ ] **Step 2: Traduci `marketing/content/en/home.html`**

Traduci ogni stringa visibile del fragment `content/it/home.html`: badge, `<h1>`, lead, CTA, hint installazione, le 6 feature card (titolo + corpo), la sezione SEO (`Perché usare un cannabis tracker` → `Why use a cannabis tracker`), la sezione finale, + il JSON-LD `WebApplication` (`description` in EN, `inLanguage` invariato). Mantieni gli `id` `installRow`/`installBtn`/`installHint`.

- [ ] **Step 3: Traduci `marketing/content/en/how-it-works.html`**

7 sezioni numerate + intro + CTA + rimando FAQ. Nessun JSON-LD.

- [ ] **Step 4: Traduci `marketing/content/en/faq.html`**

8 `<details>` (summary + risposta) + `<h1>` `Domande frequenti`→`FAQ` (o `Frequently asked questions`) + breadcrumb + CTA. **E** il blocco JSON-LD `FAQPage`: ogni `name`/`text` tradotto, 1:1 con le risposte visibili. Mantieni `id="installazione"` sul `<details>` corrispondente (il link `/faq#installazione` dalla home EN diventa `/en/faq#installazione` via `localizeLinks`).

- [ ] **Step 5: Build + verify**

Run: `rm -rf dist && npm run build`
Expected: `verify-marketing OK — 14 pagine`. (verify non controlla che il testo sia inglese; i controlli su lang/hreflang/JSON-LD sì.)

- [ ] **Step 6: Ispezione manuale rapida**

```bash
npx serve dist -p 5000
```
Apri `http://localhost:5000/en/`, `/en/how-it-works`, `/en/faq` — testo inglese, 0 errori console, switcher IT funziona, `<details>` FAQ si apre da `#installazione`.

- [ ] **Step 7: Crea `docs/superpowers/i18n-review-en.md` con la sezione pagine**

Formato: per ogni pagina, tabella a 2 colonne `IT` | `EN (bozza)`, riga per riga di contenuto (heading e paragrafi). In testa al file:

```markdown
# Revisione traduzioni EN — sito marketing

> Bozze prodotte da Claude sul branch `feat/marketing-en`. **Nessun merge su `main`
> prima dell'ok di Matteo su questa pagina.** Segna ✅/✏️/❌ accanto a ogni riga o
> lascia commenti inline.

## Slug (congelati)
| Pagina | IT | EN |
|---|---|---|
| Home | `/` | `/en/` |
| Come funziona | `/come-funziona` | `/en/how-it-works` |
| FAQ | `/faq` | `/en/faq` |
| Blog | `/blog` | `/en/blog` |
| Cos'è una t-break | `/blog/cose-una-tolerance-break` | `/en/blog/what-is-a-tolerance-break` |
| Ridurre il consumo | `/blog/come-ridurre-il-consumo-di-cannabis` | `/en/blog/how-to-cut-down-cannabis-use` |
| Diario di consumo | `/blog/perche-tenere-un-diario-di-consumo` | `/en/blog/why-keep-a-consumption-diary` |
```

- [ ] **Step 8: Commit**

```bash
git add marketing/content/en/ marketing/partials/*.en.html docs/superpowers/i18n-review-en.md
git commit -m "feat(marketing): EN translations — home, how-it-works, faq + EN nav/footer"
```

---

## Task 6: Traduzione EN — blog (indice + 3 articoli)

**Files:**
- Overwrite: `marketing/content/en/blog-index.html`, `marketing/content/en/blog/tolerance-break.html`, `marketing/content/en/blog/cut-down.html`, `marketing/content/en/blog/diary.html`
- Modify: `docs/superpowers/i18n-review-en.md` (append sezione blog)

- [ ] **Step 1: Traduci `blog-index.html`**

`<h1>` `Blog`, intro, 3 blog-card (meta `Guida`→`Guide`, `Approfondimento`→`Deep dive`; `<h2>` + descrizione di ciascuna). `href` invariati (rimappati in build).

- [ ] **Step 2: Traduci `blog/tolerance-break.html`**

Prosa completa (5 `<h2>` + paragrafi + `<ul>`) + breadcrumb + CTA + JSON-LD `Article` (`headline`, `description` in EN; `author`/`publisher`/`mainEntityOfPage` invariati).

- [ ] **Step 3: Traduci `blog/cut-down.html`**

6 `<h2>` numerati + paragrafi + CTA + JSON-LD `Article`.

- [ ] **Step 4: Traduci `blog/diary.html`**

4 `<h2>` + paragrafi + CTA + JSON-LD `Article`.

- [ ] **Step 5: Build + verify + ispezione**

```bash
rm -rf dist && npm run build && npx serve dist -p 5000
```
Expected: `verify-marketing OK — 14 pagine`. Apri le 4 URL `/en/blog…`, controlla testo EN, link interni che puntano a `/en/blog/…` e `/en/how-it-works`, JSON-LD valido (view-source).

- [ ] **Step 6: Append sezione blog a `i18n-review-en.md`**

- [ ] **Step 7: Commit**

```bash
git add marketing/content/en/ docs/superpowers/i18n-review-en.md
git commit -m "feat(marketing): EN translations — blog index + 3 articles"
```

---

## Task 7: Switcher di lingua — stile e check

Lo switcher markup è già nei partial (Task 2/5). Qui: CSS nei due fogli + check in verify.

**Files:**
- Modify: `marketing.css` (append regola `.nav-lang` / `.footer-lang`)
- Modify: `landing.css` (append regola `.jt-btn--ghost` se assente, `.jt-lang-link`)
- Modify: `verify-marketing.mjs` (check switcher → controparte)

- [ ] **Step 1: CSS in `marketing.css`**

Append in fondo (rispetta lo stile del file: sezioni con banner `/* ===== */`):

```css
/* ========== LANGUAGE SWITCHER ========== */
.nav-lang {
	margin-left: 8px;
	padding: 2px 8px;
	border: 1px solid currentColor;
	border-radius: 6px;
	font-size: 0.85em;
	font-weight: 600;
	opacity: 0.75;
}
.nav-lang:hover { opacity: 1; }
.footer-lang { font-weight: 600; }
```

- [ ] **Step 2: CSS in `landing.css`**

Verifica se `.jt-btn--ghost` esiste già (grep). Se sì, aggiungi solo:

```css
/* ========== LANGUAGE SWITCHER ========== */
.jt-lang-link { font-weight: 700; }
```

Se `.jt-btn--sm.jt-btn--ghost` non rende bene come pill piccola, aggiungi una regola mirata `.jt-nav__links .jt-btn--ghost.jt-btn--sm { … }` coerente col resto del file.

- [ ] **Step 3: Check in `verify-marketing.mjs`**

Nel loop pagine, dopo C7:

```js
	// C10 switcher lingua presente e punta alla controparte
	const otherUrl = urlFor(p, loc === 'it' ? 'en' : 'it');
	if (!html.includes(`href="${otherUrl}"`)) fail(`${path}: link switcher a ${otherUrl} mancante`);
```

- [ ] **Step 4: Build + verify + visual**

```bash
rm -rf dist && npm run build && npx serve dist -p 5000
```
Apri `/` e `/en/` (desktop + 375px, light + dark): pill EN/IT visibile nel nav, cliccabile, porta alla controparte. Idem una pagina `site` (`/faq` ↔ `/en/faq`).

- [ ] **Step 5: Commit**

```bash
git add marketing.css landing.css verify-marketing.mjs
git commit -m "feat(marketing): style the language switcher, verify counterpart link"
```

---

## Task 8: Banner soft di suggerimento lingua (IT→EN)

**Files:**
- Overwrite: `marketing/partials/lang-banner.html` (era vuoto)
- Modify: `marketing.css` (stile `.lang-hint`)

**Interfaces:**
- Consumes: `{{ALT_URL}}` iniettato da `render()` (già gestito: `banner` usa `replaceAll('{{ALT_URL}}', alt)`).
- Il banner è incluso **solo** nelle pagine IT (`render()`: `loc === 'it'`).

- [ ] **Step 1: Scrivi `marketing/partials/lang-banner.html`**

```html
<div class="lang-hint" id="langHint" hidden>
	<span>This page is also available in English.</span>
	<a href="{{ALT_URL}}" hreflang="en" lang="en">View in English →</a>
	<button type="button" aria-label="Dismiss">&times;</button>
</div>
<script>
(function () {
	try {
		var langs = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
		if (/(^|,)it/.test(langs)) return;                 // browser IT: niente banner
		if (localStorage.getItem('jt_lang_hint') === 'dismissed') return;
		var el = document.getElementById('langHint');
		if (!el) return;
		el.hidden = false;
		el.querySelector('button').addEventListener('click', function () {
			el.hidden = true;
			try { localStorage.setItem('jt_lang_hint', 'dismissed'); } catch (e) {}
		});
	} catch (e) {}
})();
</script>
```

- [ ] **Step 2: Stile `.lang-hint` in `marketing.css`**

```css
/* ========== LANGUAGE HINT BANNER ========== */
.lang-hint {
	display: flex;
	align-items: center;
	gap: 12px;
	justify-content: center;
	flex-wrap: wrap;
	padding: 8px 16px;
	background: #0c120c;
	color: #f4f7f6;
	font-size: 0.9rem;
	text-align: center;
}
.lang-hint a { color: inherit; text-decoration: underline; font-weight: 600; }
.lang-hint button {
	background: none; border: 0; color: inherit;
	font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 0 4px;
}
@media (prefers-color-scheme: light) {
	.lang-hint { background: #f4f7f6; color: #0c120c; }
}
```

(La home usa `landing.css` ma `marketing.css` è caricato comunque prima — la regola vale su entrambe le shell. Verifica visivamente sulla home.)

- [ ] **Step 3: Build + verify**

Run: `rm -rf dist && npm run build`
Expected: `verify-marketing OK`. Le pagine EN **non** devono contenere `id="langHint"` (C: aggiungi assert sotto).

Aggiungi in `verify-marketing.mjs`, nel loop, dopo C10:

```js
	// C11 banner solo su IT
	const hasBanner = html.includes('id="langHint"');
	if (loc === 'en' && hasBanner) fail(`${path}: banner lang presente su pagina EN`);
	if (loc === 'it' && !hasBanner) fail(`${path}: banner lang mancante su pagina IT`);
```

Ri-esegui `npm run build`.

- [ ] **Step 4: Test comportamentale**

```bash
npx serve dist -p 5000
```
- DevTools → Sensors/Console: con `navigator.languages` che include `it` → apri `/` → **nessun** banner.
- Emula lingua `en-US` (DevTools: More tools → Sensors → Location/Locale, oppure avvia il browser con `--lang=en-US`) → apri `/` → banner visibile; click su `×` → sparisce; ricarica → resta nascosto (`localStorage jt_lang_hint`).
- Apri `/en/` con browser EN → nessun banner (è pagina EN).
- Click "View in English →" → porta a `/en/`.

- [ ] **Step 5: Commit**

```bash
git add marketing/partials/lang-banner.html marketing.css verify-marketing.mjs
git commit -m "feat(marketing): soft IT->EN language hint banner (no auto-redirect)"
```

---

## Task 9: `vercel.json` → `cleanUrls`, aggiorna serve locale

**Files:**
- Modify: `vercel.json` (rimuovi `rewrites`, aggiungi `"cleanUrls": true`)
- Modify: `.claude/serve.json` (rispecchia `cleanUrls`)

- [ ] **Step 1: Modifica `vercel.json`**

Rimuovi l'intero blocco `"rewrites": [ … ]`. Aggiungi `"cleanUrls": true` come prima chiave dopo `outputDirectory`. Il blocco `"headers"` resta **identico**. Risultato:

```json
{
	"buildCommand": "npm run build",
	"outputDirectory": "dist",
	"cleanUrls": true,
	"headers": [ … invariato … ]
}
```

- [ ] **Step 2: Modifica `.claude/serve.json`**

```json
{
	"cleanUrls": true,
	"trailingSlash": false,
	"directoryListing": false,
	"rewrites": [
		{ "source": "/app", "destination": "/app/index.html" },
		{ "source": "/admin", "destination": "/admin.html" }
	]
}
```

(Con `cleanUrls` i `.html` marketing si risolvono da soli; restano solo i due rewrite “di cartella”. Nota: `.claude/launch.json` serve `.` in locale, non `dist/` — quindi in locale le pagine marketing NON esistono se non si builda. Aggiorna `launch.json` `runtimeArgs` per servire `dist`: vedi Step 3.)

- [ ] **Step 3: Modifica `.claude/launch.json`**

Cambia l'ultimo arg da `"."` a `"dist"` e aggiungi un commento in `CLAUDE.md` (Task 10). Il preview ora richiede `npm run build` prima.

```json
			"runtimeArgs": ["-y", "serve", "-l", "3000", "-c", ".claude/serve.json", "dist"],
```

- [ ] **Step 4: Test locale end-to-end**

```bash
rm -rf dist && npm run build && npx serve -c .claude/serve.json -l 3000 dist
```
Verifica (curl o browser), attese tutte 200 e contenuto giusto:
`/` `/en/` `/come-funziona` `/en/how-it-works` `/faq` `/en/faq` `/blog` `/en/blog` `/blog/cose-una-tolerance-break` `/en/blog/what-is-a-tolerance-break` `/app` `/admin` `/sitemap.xml` `/robots.txt`.
E i redirect `.html`: `/come-funziona.html` → 308 → `/come-funziona`.

```bash
for u in / /en/ /come-funziona /en/how-it-works /faq /en/faq /blog /en/blog /app /admin /sitemap.xml; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000$u"; done
```

- [ ] **Step 5: Commit**

```bash
git add vercel.json .claude/serve.json .claude/launch.json
git commit -m "build(marketing): switch Vercel to cleanUrls, serve dist/ locally"
```

---

## Task 10: Verifica finale, `robots.txt`, `CLAUDE.md`, screenshot

**Files:**
- Verify: `robots.txt` (nessuna modifica attesa)
- Modify: `CLAUDE.md` (sezione struttura sito + comandi)
- Delete: `marketing/baseline/`, `marketing/parity-check.mjs` (temporanei)

- [ ] **Step 1: `robots.txt`**

Conferma che va bene così com'è: `Allow: /` copre `/en/`, `Disallow: /admin` resta, `Sitemap:` punta a `/sitemap.xml` (ora generato, stesso URL). Nessuna modifica. Se vuoi essere esplicito puoi aggiungere una riga di commento, ma non necessario.

- [ ] **Step 2: Walk completo nel browser**

`npm run build` poi `npx serve -c .claude/serve.json dist`. Per ognuna delle 14 pagine: desktop + 375px, tema chiaro + scuro → 0 errori console/network, layout intatto, switcher ok. Sulla home EN: prova `beforeinstallprompt` (Chrome desktop: bottone Installa compare), redirect standalone non attivo in tab normale.

- [ ] **Step 3: Lighthouse**

Chrome DevTools → Lighthouse, mobile, su `http://localhost:3000/` e `/en/`. Atteso ~ perf 90+, a11y 100, best-practices 95+, SEO 100. Se SEO < 100, leggi il dettaglio (di solito `hreflang` o `canonical`): correggi e ricontrolla.

- [ ] **Step 4: Validazione hreflang esterna (facoltativa, se rete disponibile)**

Incolla il sorgente di `/` e `/en/` in un validatore hreflang, oppure verifica a mano che ogni coppia sia reciproca (già coperto da `verify` C3/C8, ma un occhio esterno aiuta prima dell'indicizzazione).

- [ ] **Step 5: Rimuovi i file temporanei**

```bash
git rm -r marketing/baseline marketing/parity-check.mjs
```
(Il parity check ha già fatto il suo lavoro; non serve in CI. Se preferisci tenerlo, spostalo in `docs/` e non referenziarlo dal build.)

- [ ] **Step 6: Aggiorna `CLAUDE.md`**

Nella sezione "Organizzazione file" / "Comandi utili", sostituisci la descrizione delle pagine marketing statiche con:

```markdown
- Le pagine marketing (IT + EN) sono generate a build time da `build-marketing.mjs`
  a partire da `marketing/` (`routes.json` = slug/meta/hreflang, `layout.html` +
  `partials/` = guscio, `content/{it,en}/*` = testo). NON esistono più file HTML
  marketing top-level. Gli URL EN sono `/en/…` con slug tradotti (vedi `routes.json`).
  `sitemap.xml` è generato (non committato). `vercel.json` usa `cleanUrls`.
  `verify-marketing.mjs` gira dentro `npm run build` e blocca il deploy se
  hreflang/canonical/sitemap non tornano.
- Sviluppo locale marketing: `npm run build && npx serve -c .claude/serve.json dist`
  (il preview serve `dist/`, non la root — le pagine marketing vanno buildate).
- Traduzioni EN: bozze in `marketing/content/en/`, revisione in
  `docs/superpowers/i18n-review-en.md`.
```

Aggiorna anche la riga in "Comandi utili" sul dev server locale (`npx serve .` → `npx serve -c .claude/serve.json dist`).

- [ ] **Step 7: Build pulita finale**

```bash
rm -rf dist && npm run build && npm run verify:marketing
```
Expected: tutto verde.

- [ ] **Step 8: Screenshot per Matteo**

Cattura: home IT, home EN, `/en/faq`, `/en/blog/what-is-a-tolerance-break`, banner soft attivo su `/` con browser EN. Inviali con `SendUserFile`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs(marketing): update CLAUDE.md, drop temp parity tooling; final verification"
```

---

## Task 11: Revisione traduzioni + merge

**Gate umano — non saltabile.**

- [ ] **Step 1: Presenta `docs/superpowers/i18n-review-en.md` a Matteo**

Messaggio con: link al file di review, link ai 5 screenshot, istruzioni per provare in locale (`npm run build && npx serve -c .claude/serve.json dist`, poi `/en/`).

- [ ] **Step 2: Applica le correzioni richieste**

Ogni modifica ai testi EN → nel fragment `marketing/content/en/**` corrispondente. Dopo ogni giro: `npm run build` (verify deve restare verde), commit `fix(marketing): revisione EN — <pagina>`.

- [ ] **Step 3: Solo dopo l'ok esplicito di Matteo sulle traduzioni**

```bash
git checkout main
git merge --ff-only feat/marketing-en    # oppure PR se preferisci la review su GitHub
git push origin main
```

- [ ] **Step 4: Post-deploy (Vercel auto-build)**

- `https://joint-tracker.vercel.app/en/` risponde 200, testo EN.
- `https://joint-tracker.vercel.app/sitemap.xml` ha 14 `<loc>` + alternates.
- Google Search Console: invia di nuovo la sitemap; controlla il report "Pagine" nei giorni seguenti per l'indicizzazione di `/en/…` e assenza di errori hreflang.
- `robots.txt` invariato, `/admin` ancora `Disallow` + non raggiungibile pubblicamente.

- [ ] **Step 5: Aggiorna la memoria**

Aggiorna `C:\Users\Matteo\.claude\projects\C--Users-Matteo\memory\project_joint_tracker.md`: Project B fatto, struttura `marketing/`, `cleanUrls`, come si buildano/servono le pagine marketing ora.

---

## Self-Review

**1. Spec coverage**

| Requisito spec | Task |
|---|---|
| Mappa URL 14 pagine, slug EN tradotti | 1 (routes.json) |
| Templating build-time da partial | 2, 3 |
| Fragment di solo contenuto + JSON-LD inline | 2 (IT), 5–6 (EN) |
| `build-marketing.mjs` chiamato da `build.mjs`, `STATIC_ENTRIES` sfoltito | 3 |
| Rimozione HTML top-level + `sitemap.xml` | 3 |
| hreflang trio + canonical self + og:locale | 3 (gen), 3+4 (verify) |
| sitemap generata con `xhtml:link` | 3 |
| `cleanUrls` in `vercel.json` + fallback documentato | 9 (+ spec ha il fallback) |
| `.claude/serve.json` aggiornato | 9 |
| Switcher lingua nel nav + footer, → controparte | 2, 5 (markup), 7 (stile+verify) |
| Banner soft IT→EN, no redirect, dismissible | 8 |
| Traduzioni EN 6 pagine + 3 post | 5, 6 |
| `i18n-review-en.md` | 5, 6 |
| Gate: nessun merge prima della review | 11 |
| Test: walk 14 URL, light/dark, 375+desktop | 10 |
| Test: reciprocità hreflang, 1 JSON-LD/pagina, sitemap, canonical | `verify-marketing.mjs` (3,4,7,8) |
| Lighthouse parità | 10 |
| Parity IT verbatim | 2 (baseline), 3 (parity-check) |
| `CLAUDE.md` aggiornato | 10 |
| Fuori scope `/app`, `/admin`, altre lingue, testi IT | rispettato ovunque |

**2. Placeholder scan:** nessun "TBD/TODO" nei passi. Le traduzioni EN (Task 5–6) sono descritte con regole + mappa sorgente→destinazione anziché prosa completa: è intenzionale (il testo lo produce l'esecutore, il gate è la review umana del Task 11), non un placeholder di codice.

**3. Type consistency:** `buildMarketing(outDir)`, `urlFor(page, loc)`, `outPathFor(page, loc)`, `routes` esportati dal Task 3 e importati con quei nomi in `verify-marketing.mjs` (Task 3,4,7,8) e `parity-check.mjs` (Task 3). Token del layout (`{{LANG}} {{HEAD}} {{BANNER}} {{NAV}} {{MAIN}} {{FOOTER}} {{FOOT}}`) coerenti tra `layout.html` (Task 2) e `render()` (Task 3). `{{ALT_URL}}` coerente tra partial (Task 2,5) e `render()` (Task 3). `localStorage` key `jt_lang_hint` coerente (Task 8). Classi switcher `.nav-lang`/`.footer-lang`/`.jt-lang-link` coerenti tra partial (Task 2,5) e CSS (Task 7).

**4. Ambiguity:** "estrai righe N–M" per i fragment IT è indicativo — l'esecutore deve prendere il blocco di contenuto tra `</nav>` e `<footer>` + spostare il JSON-LD dal `<head>` in coda al fragment. Reso esplicito nella tabella del Task 2 Step 7.
