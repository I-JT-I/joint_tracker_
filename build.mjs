// Build di produzione: minifica JS/CSS con esbuild, li rinomina con un hash del
// contenuto (cache-busting) e copia il resto (HTML, manifest, icone, locali,
// service worker...) dentro dist/, riscrivendo i riferimenti ai file rinominati
// in index.html e sw.js. Un nuovo deploy con contenuto diverso produce un URL
// diverso: questo permette a vercel.json di dare a questi file una cache lunga
// e immutabile senza rischiare di servire codice vecchio a chi ha gia' visitato
// il sito (vedi "Cache HTTP" nel resoconto di ottimizzazione).
// In locale i sorgenti (app.js, style.css...) restano serviti direttamente e non
// minificati/rinominati: questo script gira solo in fase di deploy (vedi
// vercel.json -> buildCommand).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { buildMarketing } from './build-marketing.mjs';

const OUT = 'dist';

// Hash dell'albero sorgente marketing/ (routes.json + layout + partials + content):
// un deploy che cambia solo il marketing deve comunque bustare CACHE_NAME del SW,
// che altrimenti (derivato dal solo hash di app.js) servirebbe l'HTML marketing
// pre-branch ai visitatori di ritorno fino al secondo load.
function hashDir(dir) {
	const files = [];
	(function walk(d) {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = join(d, e.name);
			if (e.isDirectory()) walk(full);
			else files.push(full);
		}
	})(dir);
	const h = createHash('sha256');
	for (const f of files) { h.update(f.replace(/\\/g, '/')); h.update(readFileSync(f)); }
	return h.digest('hex').slice(0, 10);
}
const mktHash = hashDir('marketing');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const STATIC_ENTRIES = [
	'manifest.json', 'robots.txt',
	'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png',
	'icon-192.png', 'icon-384.png', 'icon-512.png', 'icon-1024.png',
	'icon-maskable-192.png', 'icon-maskable-384.png', 'icon-maskable-512.png', 'icon-maskable-1024.png',
	'locales', 'splash', 'img',
	// CSS marketing (non hashati) + og-image + admin. Le PAGINE marketing non sono
	// piu' qui: le genera build-marketing.mjs da marketing/** (vedi sotto), sitemap.xml
	// inclusa. landing.css è servito solo dalla landing; le altre pagine usano marketing.css.
	'marketing.css', 'landing.css', 'og-image.png',
	'admin.html'
];

for (const entry of STATIC_ENTRIES) {
	if (existsSync(entry)) cpSync(entry, `${OUT}/${entry}`, { recursive: true });
}

async function buildHashed(entryPoint) {
	const result = await build({ entryPoints: [entryPoint], minify: true, write: false });
	const contents = result.outputFiles[0].contents;
	const hash = createHash('sha256').update(contents).digest('hex').slice(0, 10);
	const dot = entryPoint.lastIndexOf('.');
	const hashedName = `${entryPoint.slice(0, dot)}.${hash}${entryPoint.slice(dot)}`;
	writeFileSync(`${OUT}/${hashedName}`, contents);
	return hashedName;
}

const appHashed = await buildHashed('app.js');
const i18nHashed = await buildHashed('i18n.js');
const styleHashed = await buildHashed('style.css');

// app/index.html (la SPA vera e propria, dietro /app): riscrive i riferimenti
// assoluti (invariati nel sorgente) ai nomi con hash. La landing page e le altre
// pagine marketing in STATIC_ENTRIES non referenziano questi file e vengono
// copiate cosi' come sono.
mkdirSync(`${OUT}/app`, { recursive: true });
let appHtml = readFileSync('app/index.html', 'utf8');
appHtml = appHtml.replaceAll('href="/style.css"', `href="/${styleHashed}"`);
appHtml = appHtml.replaceAll('src="/app.js"', `src="/${appHashed}"`);
appHtml = appHtml.replaceAll('src="/i18n.js"', `src="/${i18nHashed}"`);
writeFileSync(`${OUT}/app/index.html`, appHtml);

// sw.js: stesso discorso per la precache list, piu' un CACHE_NAME derivato
// dall'hash di app.js cosi' cambia automaticamente a ogni deploy con codice
// diverso, senza doverlo ricordare di bumpare a mano.
let sw = readFileSync('sw.js', 'utf8');
sw = sw.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'jointtracker-${appHashed.replace('app.', '').replace('.js', '')}-${mktHash}';`);
sw = sw.replace("'/style.css'", `'/${styleHashed}'`);
sw = sw.replace("'/app.js'", `'/${appHashed}'`);
sw = sw.replace("'/i18n.js'", `'/${i18nHashed}'`);
writeFileSync(`${OUT}/sw.js`, sw);

// Pagine marketing IT/EN + sitemap.xml, montate da marketing/** dentro dist/**.
buildMarketing(OUT);

console.log(`Build completata in ./dist (app.js -> ${appHashed}, i18n.js -> ${i18nHashed}, style.css -> ${styleHashed})`);
