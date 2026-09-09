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

// escAttr: per i valori di attributo (contengono "). escText: per il contenuto di
// <title> (le " non vanno escapate). Esportati e riusati da verify-marketing.mjs
// (C4b) per non avere due implementazioni che possono divergere.
export const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// callback form ovunque: il value non deve mai essere interpretato come pattern
// di replacement ($&, $1, ...) — vedi Global Constraint del piano.
const put = (tpl, token, value) => tpl.replace(token, () => value);
const putAll = (tpl, token, value) => tpl.replaceAll(token, () => value);

// EN home is a clean URL with NO trailing slash: cleanUrls (serve + Vercel)
// 301-redirects /en/ -> /en, and canonical/hreflang/sitemap must point at the
// final 200 URL. Non-empty EN slugs already produce /en/<slug> correctly.
// mkEnPath/mkItPath = sola porzione path (root-relative), unica fonte di verita'
// per la forma del path: la usano sia gli URL assoluti (mkEnUrl/mkItUrl) sia
// localizeLinks sia lo switcher in-page.
export const mkEnPath = (slug) => (slug ? `/en/${slug}` : '/en');
export const mkItPath = (slug) => (slug ? `/${slug}` : '/');
export const mkEnUrl = (slug) => routes.baseUrl + mkEnPath(slug);
export const mkItUrl = (slug) => routes.baseUrl + mkItPath(slug);

export function urlFor(page, loc) {
	const slug = page[loc].slug;
	return loc === 'it' ? mkItUrl(slug) : mkEnUrl(slug);
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
		`<title>${escText(m.title)}</title>`,
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

// Nei fragment/partial EN gli href interni sono scritti come path IT (i traduttori
// toccano solo il testo): qui li rimappo alle controparti EN. /app e ancore # preservati.
function localizeLinks(html, loc) {
	if (loc === 'it') return html;
	const map = new Map();
	for (const p of routes.pages) {
		map.set(mkItPath(p.it.slug), mkEnPath(p.en.slug));
	}
	return html.replace(/href="(\/[a-z0-9\-/]*)(#[^"]*)?"/gi, (mtch, path, hash = '') => {
		if (path === '/app' || path.startsWith('/app/')) return mtch;
		const en = map.get(path);
		return en ? `href="${en}${hash || ''}"` : mtch;
	});
}

// Nei fragment EN il JSON-LD incorporato self-referenzia la URL assoluta IT
// (i traduttori toccano solo headline/description): qui rimappo le self-URL
// assolute virgolettate alla controparte EN, ma SOLO dentro i blocchi
// <script type="application/ld+json">. Il resto dell'HTML resta intatto: il
// language switcher di nav/footer linka di proposito la URL IT via href=, e i
// tag canonical/og/twitter di headFor() sono gia' corretti.
function localizeLdJsonUrls(html, loc) {
	if (loc === 'it') return html;
	const map = new Map();
	for (const p of routes.pages) {
		const it = `"${mkItUrl(p.it.slug)}"`;
		const en = `"${mkEnUrl(p.en.slug)}"`;
		map.set(it, en);
	}
	return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (block) => {
		let out = block;
		for (const [it, en] of map) out = out.replaceAll(it, () => en);
		return out;
	});
}

const FOOT = [
	`<script>window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)};</script>`,
	`<script defer src="/_vercel/speed-insights/script.js"></script>`,
].join('\n');

function render(page, loc) {
	const frag = localizeLdJsonUrls(localizeLinks(readFileSync(`${M}/content/${loc}/${page.key}.html`, 'utf8').trim(), loc), loc);
	// Lo switcher/banner in-page devono essere root-relative: un link assoluto a
	// produzione romperebbe la review su localhost / preview Vercel. canonical /
	// hreflang / og:url / sitemap restano assoluti (li genera headFor/writeSitemap).
	const altPath = other(loc) === 'en' ? mkEnPath(page.en.slug) : mkItPath(page.it.slug);
	const nav = putAll(localizeLinks(partial(`nav.${page.shell}.${loc}.html`), loc), '{{ALT_URL}}', altPath);
	const footer = putAll(localizeLinks(partial(`footer.${page.shell}.${loc}.html`), loc), '{{ALT_URL}}', altPath);
	const banner = loc === 'it' ? putAll(partial('lang-banner.html'), '{{ALT_URL}}', altPath) : '';
	const pageOpen = page.shell === 'landing' ? '<div class="jt-page">' : '';
	const pageClose = page.shell === 'landing' ? '</div>' : '';
	let doc = put(layout, '{{LANG}}', loc);
	doc = put(doc, '{{HEAD}}', headFor(page, loc));
	doc = put(doc, '{{BANNER}}', banner);
	doc = put(doc, '{{PAGE_OPEN}}', pageOpen);
	doc = put(doc, '{{NAV}}', nav);
	doc = put(doc, '{{MAIN}}', frag);
	doc = put(doc, '{{FOOTER}}', footer);
	doc = put(doc, '{{PAGE_CLOSE}}', pageClose);
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
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
	writeFileSync(join(outDir, 'sitemap.xml'), xml);
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
