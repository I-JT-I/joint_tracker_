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
