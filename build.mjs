// Build di produzione: minifica JS/CSS con esbuild e copia il resto (HTML, manifest,
// icone, locali, service worker...) così com'è dentro dist/. Mantiene gli stessi nomi
// file dei sorgenti, cosi' index.html non deve puntare a percorsi diversi.
// In locale i sorgenti (app.js, style.css...) restano serviti direttamente e non minificati:
// questo script gira solo in fase di deploy (vedi vercel.json -> buildCommand).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';

const OUT = 'dist';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const STATIC_ENTRIES = [
	'index.html', 'manifest.json', 'robots.txt', 'sitemap.xml', 'sw.js',
	'icon-192.png', 'icon-384.png', 'icon-512.png', 'icon-1024.png',
	'icon-maskable-192.png', 'icon-maskable-384.png', 'icon-maskable-512.png', 'icon-maskable-1024.png',
	'locales', 'splash'
];

for (const entry of STATIC_ENTRIES) {
	if (existsSync(entry)) cpSync(entry, `${OUT}/${entry}`, { recursive: true });
}

await build({ entryPoints: ['app.js'], outfile: `${OUT}/app.js`, minify: true });
await build({ entryPoints: ['i18n.js'], outfile: `${OUT}/i18n.js`, minify: true });
await build({ entryPoints: ['style.css'], outfile: `${OUT}/style.css`, minify: true });

console.log('Build completata in ./dist');
