// Valida marketing/routes.json e l'output in dist/ dopo `node build.mjs`.
// Exit 1 su qualsiasi violazione. Esegui: npm run verify:marketing
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { routes, urlFor, outPathFor, escText, escAttr, mkEnPath, mkItPath } from './build-marketing.mjs';

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
// EN clean URLs are never a trailing-slash URL (cleanUrls 301s /en/ -> /en)
for (const p of routes.pages) {
	if (urlFor(p, 'en').endsWith('/')) fail(`urlFor(${p.key}, 'en') termina con "/": ${urlFor(p, 'en')}`);
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

	// C4b title/description = routes.json (stessi helper del build: nessuna deriva)
	const m = p[loc];
	if (!html.includes(`<title>${escText(m.title)}</title>`)) fail(`${path}: <title> != routes.json`);
	if (!html.includes(`<meta name="description" content="${escAttr(m.description)}">`)) fail(`${path}: description != routes.json`);

	// C5 esattamente 1 JSON-LD valido (se presente)
	const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
	if (ld.length > 1) fail(`${path}: ${ld.length} blocchi JSON-LD (atteso 0 o 1)`);
	for (const m of ld) { try { JSON.parse(m[1]); } catch { fail(`${path}: JSON-LD non valido`); } }

	// C5b nessuna self-URL IT residua dentro il JSON-LD delle pagine EN
	if (loc === 'en') {
		const ldBlocks = ld.map((m) => m[1]);
		for (const q of routes.pages) {
			const itSelf = `"${routes.baseUrl}/${q.it.slug}"`;
			for (const block of ldBlocks) {
				if (block.includes(itSelf)) fail(`${path}: JSON-LD self-URL IT non localizzata (${itSelf})`);
			}
		}
	}

	// C6 nessun placeholder / attributo morto residuo
	if (html.includes('{{')) fail(`${path}: placeholder {{...}} non risolto`);
	if (html.includes('data-i18n')) fail(`${path}: attributo data-i18n residuo`);

	// C7 nessun link interno IT nelle pagine EN (localizeLinks mancato). Lo switcher
	// lingua punta di proposito alla controparte IT (root-relative): escludilo.
	if (loc === 'en') {
		const htmlNoSwitcher = html.replace(/<a\b[^>]*\bhreflang="it"[^>]*>[^<]*<\/a>/g, '');
		for (const q of routes.pages) {
			const itSlug = q.it.slug ? `/${q.it.slug}` : '/';
			if (htmlNoSwitcher.includes(`href="${itSlug}"`) || htmlNoSwitcher.includes(`href="${itSlug}#`)) {
				fail(`${path}: link IT non localizzato (${itSlug})`);
			}
		}
	}

	// C10 switcher lingua presente e punta alla controparte, root-relative
	const altPath = loc === 'it' ? mkEnPath(p.en.slug) : mkItPath(p.it.slug);
	if (!html.includes(`href="${altPath}"`)) fail(`${path}: link switcher a ${altPath} mancante`);

	// C11 banner solo su IT
	const hasBanner = html.includes('id="langHint"');
	if (loc === 'en' && hasBanner) fail(`${path}: banner lang presente su pagina EN`);
	if (loc === 'it' && !hasBanner) fail(`${path}: banner lang mancante su pagina IT`);
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
