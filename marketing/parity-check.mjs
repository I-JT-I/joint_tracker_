// Confronta il testo visibile delle pagine IT renderizzate con le copie in
// marketing/baseline/. Deve combaciare (modulo nav/footer/switcher/whitespace).
import { readFileSync } from 'fs';
import { routes, outPathFor } from '../build-marketing.mjs';

const strip = (h) => h
	.replace(/<script[\s\S]*?<\/script>/g, ' ')
	.replace(/<style[\s\S]*?<\/style>/g, ' ')
	.replace(/<svg[\s\S]*?<\/svg>/g, ' ')
	.replace(/<[^>]+>/g, ' ')
	.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

// token introdotti dal nuovo guscio, da ignorare nel confronto
const NOISE = ['This page is also available in English', 'English', 'EN'];
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
