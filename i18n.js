// ========== i18n: dizionari leggeri, nessuna libreria esterna ==========
const I18N_SUPPORTED = ['it', 'en'];
const I18N_FALLBACK = 'it';

let currentLocale = I18N_FALLBACK;
const i18nDicts = {};

// Codice locale da passare a toLocaleDateString()/toLocaleString() per formattare
// date/numeri nella lingua correntemente attiva.
function localeCode() {
	return currentLocale === 'it' ? 'it-IT' : 'en-US';
}

// Formatta una data "YYYY-MM-DD" come data breve nella lingua attiva:
// GG/MM/AAAA in italiano, MM/GG/AAAA in inglese (entrambi zero-padded).
// Costruisce la Date da componenti locali (non new Date(str) diretto) per evitare
// lo slittamento di un giorno che darebbe l'interpretazione UTC su fusi > UTC.
function formatShortDate(dateStr) {
	const [y, m, d] = dateStr.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return new Intl.DateTimeFormat(localeCode(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function detectBrowserLocale() {
	const lang = ((navigator.language || navigator.userLanguage || '') + '').toLowerCase();
	return lang.startsWith('it') ? 'it' : 'en';
}

function i18nGetNested(obj, path) {
	return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

async function loadLocaleDict(locale) {
	if (i18nDicts[locale]) return i18nDicts[locale];
	const res = await fetch(`locales/${locale}.json`);
	const data = await res.json();
	i18nDicts[locale] = data;
	return data;
}

// t('stats.streakFootnote', {days: 3}) -> sostituisce {days} nel valore trovato
function t(key, vars) {
	let val = i18nGetNested(i18nDicts[currentLocale], key);
	if (val === undefined) val = i18nGetNested(i18nDicts[I18N_FALLBACK], key);
	if (val === undefined) return key;
	if (Array.isArray(val)) return val;
	if (vars) {
		Object.keys(vars).forEach(k => {
			val = val.replaceAll(`{${k}}`, vars[k]);
		});
	}
	return val;
}

// tn('key', count, vars) cerca prima 'key_one' (count===1) o 'key_other', altrimenti ricade su t()
function tn(key, count, vars) {
	const suffix = count === 1 ? '_one' : '_other';
	const fullVars = Object.assign({ count }, vars);
	let val = i18nGetNested(i18nDicts[currentLocale], key + suffix);
	if (val === undefined) val = i18nGetNested(i18nDicts[I18N_FALLBACK], key + suffix);
	if (val === undefined) return t(key, fullVars);
	Object.keys(fullVars).forEach(k => {
		val = val.replaceAll(`{${k}}`, fullVars[k]);
	});
	return val;
}

function applyStaticTranslations() {
	document.querySelectorAll('[data-i18n]').forEach(el => {
		el.textContent = t(el.getAttribute('data-i18n'));
	});
	document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
		el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
	});
	document.querySelectorAll('[data-i18n-title]').forEach(el => {
		el.title = t(el.getAttribute('data-i18n-title'));
	});
	document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
		el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
	});
	document.documentElement.setAttribute('lang', currentLocale);
	const metaDesc = document.querySelector('meta[name="description"]');
	if (metaDesc) metaDesc.setAttribute('content', t('meta.description'));
	syncLanguageRadio();
	syncAuthLangButtons();
}

function syncLanguageRadio() {
	document.querySelectorAll('#languageOptions input[name="languageChoice"]').forEach(r => {
		r.checked = (r.value === currentLocale);
		r.parentElement.classList.toggle('selected', r.checked);
	});
}

// Evidenzia la bandierina della lingua attiva nella pagina di login (pre-accesso/ospite).
function syncAuthLangButtons() {
	document.querySelectorAll('#authLangSwitch .lang-flag-btn').forEach(b => {
		b.classList.toggle('active', b.dataset.lang === currentLocale);
	});
}

// Cambia lingua a runtime: salva su localStorage + (se loggato) su profiles.language,
// poi ri-applica le traduzioni statiche e notifica il resto dell'app.
async function setLocale(locale, opts) {
	opts = opts || {};
	if (!I18N_SUPPORTED.includes(locale)) locale = I18N_FALLBACK;
	await loadLocaleDict(locale);
	currentLocale = locale;
	try { localStorage.setItem('jt_locale', locale); } catch (e) {}
	if (opts.persist !== false && typeof currentUser !== 'undefined' && currentUser) {
		try {
			await supabaseClient.from('profiles').update({ language: locale }).eq('id', currentUser.id);
		} catch (e) {}
	}
	applyStaticTranslations();
	document.dispatchEvent(new CustomEvent('i18n:change', { detail: { locale } }));
}

// Ordine di priorità: preferenza su Supabase (se loggato) > localStorage > navigator.language
async function initI18n() {
	let locale = null;

	if (typeof currentUser !== 'undefined' && currentUser) {
		try {
			const { data } = await supabaseClient
				.from('profiles')
				.select('language')
				.eq('id', currentUser.id)
				.single();
			if (data && data.language) locale = data.language;
		} catch (e) {}
	}

	if (!locale) {
		try { locale = localStorage.getItem('jt_locale'); } catch (e) {}
	}

	if (!locale) locale = detectBrowserLocale();
	if (!I18N_SUPPORTED.includes(locale)) locale = I18N_FALLBACK;

	await loadLocaleDict(I18N_FALLBACK);
	if (locale !== I18N_FALLBACK) await loadLocaleDict(locale);

	currentLocale = locale;
	try { localStorage.setItem('jt_locale', locale); } catch (e) {}
	applyStaticTranslations();
}
