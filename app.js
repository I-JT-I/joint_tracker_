// ========== INIZIALIZZAZIONE SUPABASE ==========
	const SUPABASE_URL = 'https://afkxmbxcavwhurmdelfr.supabase.co';
	const SUPABASE_KEY = 'sb_publishable_1rc0ueZL6Y03qhk5jp_34w_ObCOCpCP';
	const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

	// ========== VARIABILI GLOBALI ==========
	let currentUser = null;
	let smokes = [];
	let smokesLoaded = false; // false finché loadData() non ha popolato smokes: evita di mostrare la scorta come "piena" prima di conoscere il consumato
	let currentLocation = { lat: null, lng: null, name: null };
	let mapInstance = null;
	let mapMarkers = [];
	let currentSocialTab = 'global';
	let charts = {};
	let userPlaces = []; // Array per i posti caricati dal DB
	let sessionParticipants = []; // { user_id, username, avatar_url }
	// Cache dell'ultima lista amici resa dalla quick-list: quickAddParticipant()
	// la consulta per id invece di ricevere username/avatar_url in un onclick inline
	// (pattern user-string-in-onclick evitato — vedi Task 8).
	let friendsQuickCache = [];
	let isLocatingNow = false;
	let isOnline = navigator.onLine;
	let notifications = [];
	let sharedPeriod = 'month';
    let activeBreak = null;
    let pendingBreak = null; // pausa "pianificata" non ancora confermata (vedi ========== TOLERANCE BREAK ==========)
    let allBreaks = [];
	const VAPID_PUBLIC_KEY = 'BE2yG7kWhMrni1qk-uilMqHc7uGL92CZE6UaLt-sbTTHsDr4lDP6qiqnSJsxachx5kUJ7C-0dO46UeSjxOUwiG0';
	let userReminderSettings = { reminder_enabled: true, reminder_time: '20:00:00' };
	let unlockedAchievements = [];
	let currentUserProfile = null; // { username, avatar_url } — popolato da loadUserProfile()
	let friendsCountCache = 0;
	// Cache leggera del rank globale, popolata da loadSocial(): la pagina "Altro"
	// la mostra nel sottotitolo della card Social senza rifare la RPC.
	let lastGlobalRank = null; // { rank, total } | null
	// Periodo attivo della pagina Stats (redesign 2026: toggle 30d / anno / sempre)
	let statsPeriod = 'all';
	// true = la prossima updateStats() anima i numeri col count-up (solo su
	// ingresso pagina o cambio periodo, non a ogni update() di routine)
	let statsAnimateOnce = false;
	let homeAnimateOnce = false; // idem per il numero streak della Home
	let achievementsLoaded = false;
	let isGuestMode = false;

// ========== TEMA (chiaro/scuro/automatico) ==========
function getStoredThemePref() {
	try { return localStorage.getItem('jt_theme') || 'dark'; } catch (e) { return 'dark'; }
}

function resolveTheme(pref) {
	if (pref === 'auto') {
		return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
	}
	return pref;
}

function applyTheme(pref) {
	document.documentElement.setAttribute('data-theme', resolveTheme(pref));

	document.querySelectorAll('#themeOptions label').forEach(l => l.classList.remove('selected'));
	const radio = document.querySelector(`input[name="themeChoice"][value="${pref}"]`);
	if (radio) {
		radio.checked = true;
		radio.parentElement.classList.add('selected');
	}

	// I grafici usano colori legati al tema (griglia/tick): se sei sulla pagina
	// Grafici, ridisegnali col nuovo tema (altrimenti si aggiornano al reingresso).
	if (typeof Chart !== 'undefined' && typeof renderCharts === 'function' &&
		document.getElementById('page-charts')?.classList.contains('active')) {
		try { renderCharts(); } catch (e) {}
	}
}

function setTheme(pref) {
	try { localStorage.setItem('jt_theme', pref); } catch (e) {}
	applyTheme(pref);
}

function toggleTheme() {
	const current = document.documentElement.getAttribute('data-theme');
	setTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
	applyTheme(getStoredThemePref());
	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (getStoredThemePref() === 'auto') applyTheme('auto');
		});
	}
}

// Neutralizza HTML in testo libero di altri utenti prima di inserirlo via innerHTML
// (es. il nome di un posto di un amico, mostrato nelle Istantanee).
function escapeHtml(str) {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Ripartizione Fumo/Erba di una sessione per le statistiche personali: UNICA fonte per tutte
// le schermate (Home, Stats, grafici, Registro, Wrapped, pause...) e stessa regola delle RPC
// classifiche/get_friend_stats, cosi' la stessa sessione vale ovunque gli stessi grammi.
// Tre letture possibili della riga: my_fumo/erba_grams (piu' recente; nelle condivise e'
// l'intera sessione, vedi CLAUDE.md), fumo/erba_grams (contributo alla scorta), grams (colonna
// storica, l'unica valorizzata sulle sessioni piu' vecchie, ripartita secondo "type"). Vince la
// lettura con il totale maggiore: nessuna sessione risulta a 0 solo perche' una colonna piu'
// recente e' vuota (prima Stats/Home ignoravano "grams" e contavano 0 le righe storiche).
function personalSplit(s) {
	const my = { fumo: Number(s.my_fumo_grams) || 0, erba: Number(s.my_erba_grams) || 0 };
	const contrib = { fumo: Number(s.fumo_grams) || 0, erba: Number(s.erba_grams) || 0 };
	const g = Number(s.grams) || 0;
	const raw = s.type === 'erba' ? { fumo: 0, erba: g }
		: s.type === 'fumo-erba' ? { fumo: g / 2, erba: g / 2 }
		: { fumo: g, erba: 0 };
	let best = my;
	if (contrib.fumo + contrib.erba > best.fumo + best.erba) best = contrib;
	if (raw.fumo + raw.erba > best.fumo + best.erba) best = raw;
	return best;
}

// Grammi personali di una sessione (fumo + erba secondo personalSplit).
function personalGrams(s) {
	const p = personalSplit(s);
	return p.fumo + p.erba;
}

// Numero progressivo del giorno di calendario di una data "YYYY-MM-DD", calcolato in UTC:
// la differenza fra due date e' sempre un intero. new Date(str) + setHours() dava 23h/25h
// a cavallo del cambio ora legale e spezzava streak, durate e finestre (audit F-01).
function dayNum(dateStr) {
	return Math.round(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
}

// Giorno della settimana (0 = domenica) di una data "YYYY-MM-DD", indipendente dal fuso.
function weekdayOf(dateStr) {
	return new Date(Date.parse(dateStr + 'T00:00:00Z')).getUTCDay();
}

// Giorni di calendario da a a b (b − a), entrambe "YYYY-MM-DD".
function daysBetween(a, b) {
	return dayNum(b) - dayNum(a);
}

// Data di oggi "YYYY-MM-DD" nel fuso del dispositivo (mai toISOString(), che e' in UTC).
function todayStr() {
	return toDateStr(new Date());
}

// Formatta un numero per la lingua attiva (virgola decimale in italiano). Solo per testo
// mostrato: il value di un <input type="number"> vuole sempre il punto, li' resta toFixed().
function fmtNum(v, decimals = 1, minDecimals = decimals) {
	const n = Number(v) || 0;
	return new Intl.NumberFormat(localeCode(), { minimumFractionDigits: minDecimals, maximumFractionDigits: decimals }).format(n);
}

// title/desc si leggono da locales/*.json tramite achTitle()/achDesc(), non da qui,
// così restano coerenti se la lingua cambia dopo il primo render.
const ACHIEVEMENTS = [
	{ key: 'first_session', icon: '🌱', check: () => smokes.length >= 1 },
	{ key: 'sessions_10', icon: '🔥', check: () => smokes.length >= 10 },
	{ key: 'sessions_100', icon: '💯', check: () => smokes.length >= 100 },
	{ key: 'sessions_500', icon: '🏆', check: () => smokes.length >= 500 },
	// Streak record, non solo quello in corso: chi ha fatto 100 giorni di fila in passato
	// (anche prima che esistessero i traguardi) li ha raggiunti. Solo additivo, nulla si revoca.
	{ key: 'streak_7', icon: '📅', check: () => longestStreak() >= 7 },
	{ key: 'streak_30', icon: '🗓️', check: () => longestStreak() >= 30 },
	{ key: 'streak_100', icon: '💎', check: () => longestStreak() >= 100 },
	{ key: 'first_purchase', icon: '🛒', check: () => typeof purchases !== 'undefined' && purchases.length >= 1 },
	{ key: 'first_friend', icon: '🤝', check: () => friendsCountCache >= 1 },
	{ key: 'first_shared', icon: '👥', check: () => smokes.some(s => Array.isArray(s.shared_with) && s.shared_with.length > 0) },
	{ key: 'explorer', icon: '🗺️', check: () => userPlaces.length >= 5 },
	{ key: 'globe_trotter', icon: '🌍', check: () => new Set(smokes.map(s => s.location_name).filter(Boolean)).size >= 5 },
];

function achTitle(key) { return t(`achievements.${key}.title`); }
function achDesc(key) { return t(`achievements.${key}.desc`); }


	// Gestione selezione Fumo/Erba
document.querySelectorAll('.substance-checkbox-group input[type="checkbox"]').forEach(checkbox => {
	checkbox.addEventListener('change', function() {
		const label = this.parentElement;
		if (this.checked) {
			label.classList.add('selected');
		} else {
			label.classList.remove('selected');
		}
	});
});

	// Evidenzia l'opzione selezionata nei gruppi "a chip" (contesto, umore)
	function syncTagRowVisual(radioName) {
		document.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
			r.parentElement.classList.toggle('selected', r.checked);
		});
	}

	function bindTagRowSelection(radioName) {
		document.querySelectorAll(`input[name="${radioName}"]`).forEach(input => {
			input.addEventListener('change', () => syncTagRowVisual(radioName));
		});
	}

	bindTagRowSelection('contextTag');
	bindTagRowSelection('moodRating');

	// Mostra messaggio quando entrambi selezionati
document.getElementById("fumo").addEventListener('change', updateDivideMessage);
document.getElementById("erba").addEventListener('change', updateDivideMessage);

function updateDivideMessage() {
    const hasFumo = document.getElementById("fumo").checked;
    const hasErba = document.getElementById("erba").checked;
    if (typeof renderContributorsPanel === 'function') renderContributorsPanel();
    const msgDiv = document.getElementById("divideMessage");
    const notMineToggle = document.getElementById("notMineToggle");

    // Mostra il toggle "non mia" se almeno uno è selezionato
    notMineToggle.style.display = (hasFumo || hasErba) ? "block" : "none";
    if (!hasFumo && !hasErba) document.getElementById("notMineCheck").checked = false;

    if (hasFumo && hasErba) {
        const gVal = document.querySelector('input[name="g"]:checked').value;
        const grams = gVal === "custom" ? parseFloat(document.getElementById("customGrams").value) || 0.5 : parseFloat(gVal);
        const fumo = fmtNum(grams / 2, 1);
        const erba = fmtNum(grams / 2, 1);
        msgDiv.style.display = "block";
        // #divideText è opzionale (non presente nel markup attuale): guardia contro il null
        const divideText = document.getElementById("divideText");
        if (divideText) divideText.textContent = `${fumo}g 🍫 + ${erba}g 🍃`;
    } else {
        msgDiv.style.display = "none";
    }
}

function toggleSharedSession() {
    if (isGuestMode) {
        // La UI è nascosta in guest mode, ma la checkbox esiste ancora nel DOM:
        // blindiamo comunque, niente account = niente amici da caricare.
        document.getElementById('sharedSessionCheck').checked = false;
        document.getElementById('sharedSessionPanel').style.display = 'none';
        return;
    }
    const checked = document.getElementById('sharedSessionCheck').checked;
    document.getElementById('sharedSessionPanel').style.display = checked ? 'block' : 'none';
    if (checked) {
        renderFriendsQuickList();
    } else {
        sessionParticipants = [];
        renderParticipantChips();
    }
}

async function getMyFriendsList() {
    const { data: friendships, error } = await supabaseClient
        .from('friendships')
        .select('friend_id')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted');

    if (error) {
        console.error('getMyFriendsList: errore nel caricare friendships', error);
        throw error;
    }
    if (!friendships || friendships.length === 0) return [];

    const friendIds = friendships.map(f => f.friend_id);

    const { data: profilesData, error: profilesError } = await supabaseClient
        .from('profiles_public')
        .select('id, username, avatar_url')
        .in('id', friendIds);

    if (profilesError) {
        console.error('getMyFriendsList: errore nel caricare profiles_public', profilesError);
        throw profilesError;
    }

    return profilesData || [];
}

async function renderFriendsQuickList() {
    const el = document.getElementById('friendsQuickList');
    if (!el) return;
    el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted);">${t('common.loading')}</p>`;

    let friends;
    try {
        friends = await getMyFriendsList();
    } catch (e) {
        el.innerHTML = `<p style="font-size:12px; color:var(--warning-text, #c0392b);">${t('shared.friendsListLoadError') || 'Errore nel caricamento amici, riprova.'}</p>`;
        return;
    }

    if (friends.length === 0) {
        el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted);">${t('shared.noFriendsYet')}</p>`;
        return;
    }

    friendsQuickCache = friends;
    el.innerHTML = friends.map(f => `
		<button type="button" onclick="quickAddParticipant('${f.id}')" class="friend-quick-btn">
			${avatarMarkup(f.avatar_url, f.username, 22)}
			<span>+ ${escapeHtml(f.username)}</span>
		</button>
    `).join('');
}

function quickAddParticipant(id) {
    if (sessionParticipants.some(p => p.user_id === id)) return;
    const friend = friendsQuickCache.find(f => f.id === id);
    if (!friend) return;
    sessionParticipants.push({ user_id: id, username: friend.username, avatar_url: friend.avatar_url || null });
    renderParticipantChips();
}

async function searchParticipant() {
	const input = document.getElementById('participantSearch');
	const query = input.value.trim();
	if (!query) return;

	// Solo amici accettati (lo impone anche create_shared_session lato DB): confronto esatto
	// case-insensitive, niente ILIKE dove "%"/"_" farebbero da jolly su tutti i profili.
	let friends;
	try {
		friends = await getMyFriendsList();
	} catch (e) {
		return alert(t('shared.friendsListLoadError'));
	}
	friendsQuickCache = friends;
	const match = friends.find(u => (u.username || '').toLowerCase() === query.toLowerCase());
	if (!match) {
		const { data: anyUser } = await supabaseClient
			.from('profiles_public')
			.select('id')
			.eq('username', query)
			.neq('id', currentUser.id)
			.limit(1);
		return alert(anyUser && anyUser.length ? t('shared.notAFriend') : t('shared.noUserFound'));
	}

	if (sessionParticipants.some(p => p.user_id === match.id)) {
		return alert(t('shared.alreadyAdded'));
	}

	sessionParticipants.push({ user_id: match.id, username: match.username, avatar_url: match.avatar_url || null });
	input.value = "";
	renderParticipantChips();
}

function removeParticipant(id) {
    sessionParticipants = sessionParticipants.filter(p => p.user_id !== id);
    renderParticipantChips();
}

function renderParticipantChips() {
    const el = document.getElementById('participantChips');
    if (!el) return;
    el.innerHTML = sessionParticipants.map(p => `
		<span class="participant-chip">${avatarMarkup(p.avatar_url, p.username, 18)} ${escapeHtml(p.username)} <button onclick="removeParticipant('${p.user_id}')">✕</button></span>
    `).join('');
    renderContributorsPanel();
}

function renderContributorsPanel() {
    const panel = document.getElementById('contributorsPanel');
    if (!panel) return;
    if (sessionParticipants.length === 0) { panel.innerHTML = ''; return; }

    const hasFumo = document.getElementById("fumo").checked;
    const hasErba = document.getElementById("erba").checked;
    const all = [{ user_id: currentUser.id, username: t('shared.you'), avatar_url: (currentUserProfile && currentUserProfile.avatar_url) || null }, ...sessionParticipants];

    let fumoTotal = 0, erbaTotal = 0;
    if (hasFumo && hasErba) {
        fumoTotal = parseFloat(document.getElementById("fumoGramsInput")?.value) || 0;
        erbaTotal = parseFloat(document.getElementById("erbaGramsInput")?.value) || 0;
    } else {
        const gVal = document.querySelector('input[name="g"]:checked')?.value;
        const grams = gVal === "custom" ? parseFloat(document.getElementById("customGrams")?.value) : parseFloat(gVal);
        if (hasFumo) fumoTotal = grams || 0;
        if (hasErba) erbaTotal = grams || 0;
    }

    let html = `<p style="font-size:12px; color:var(--color-text-muted); margin-top:0;">${t('shared.whoBroughtIt')}</p>`;

    const isFirstRender = document.querySelectorAll('.contrib-fumo, .contrib-erba').length === 0;

    if (hasFumo) {
        const prevChecked = Array.from(document.querySelectorAll('.contrib-fumo:checked')).map(el => el.value);
        const activeIds = isFirstRender ? all.map(p => p.user_id) : prevChecked;
        const share = activeIds.length > 0 ? (fumoTotal / activeIds.length).toFixed(2) : '0.00';

        html += `<label style="margin-top:10px; font-size:12px;">${t('shared.smokeBroughtBy')}</label>`;
        html += all.map(p => `
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
                <label style="display:flex; align-items:center; gap:4px; font-size:13px; font-weight:normal; flex:1; margin-top:0;">
                    <input type="checkbox" class="contrib-fumo" value="${p.user_id}"
                        ${activeIds.includes(p.user_id) ? 'checked' : ''}
                        onchange="renderContributorsPanel()" style="width:auto;"> ${avatarMarkup(p.avatar_url, p.username, 18)} ${escapeHtml(p.username)}
                </label>
                <input type="number" step="0.01" min="0" class="contrib-fumo-amt" data-user="${p.user_id}"
                    value="${activeIds.includes(p.user_id) ? share : '0.00'}"
                    style="width:70px; margin:0; padding:6px; font-size:13px; text-align:center;">
                <span style="font-size:12px; color:var(--color-text-muted);">g</span>
            </div>
        `).join('');
    }

    if (hasErba) {
        const prevChecked = Array.from(document.querySelectorAll('.contrib-erba:checked')).map(el => el.value);
        const activeIds = isFirstRender ? all.map(p => p.user_id) : prevChecked;
        const share = activeIds.length > 0 ? (erbaTotal / activeIds.length).toFixed(2) : '0.00';

        html += `<label style="margin-top:14px; font-size:12px;">${t('shared.weedBroughtBy')}</label>`;
        html += all.map(p => `
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
                <label style="display:flex; align-items:center; gap:4px; font-size:13px; font-weight:normal; flex:1; margin-top:0;">
                    <input type="checkbox" class="contrib-erba" value="${p.user_id}"
                        ${activeIds.includes(p.user_id) ? 'checked' : ''}
                        onchange="renderContributorsPanel()" style="width:auto;"> ${avatarMarkup(p.avatar_url, p.username, 18)} ${escapeHtml(p.username)}
                </label>
                <input type="number" step="0.01" min="0" class="contrib-erba-amt" data-user="${p.user_id}"
                    value="${activeIds.includes(p.user_id) ? share : '0.00'}"
                    style="width:70px; margin:0; padding:6px; font-size:13px; text-align:center;">
                <span style="font-size:12px; color:var(--color-text-muted);">g</span>
            </div>
        `).join('');
    }

    panel.innerHTML = html;
}


// Aggiorna il messaggio anche quando cambiano i grammi
document.querySelectorAll('input[name="g"]').forEach(r => {
	r.addEventListener('change', updateDivideMessage);
});

document.getElementById("customGrams").addEventListener('input', updateDivideMessage);
	// ========== AUTENTICAZIONE ==========
	async function checkAuth() {
		const { data: { session } } = await supabaseClient.auth.getSession();
		if (session) {
			currentUser = session.user;
		}
		await initI18n();
		if (session) {
			const hadGuestData = isGuestModeStored() && hasGuestData();
			isGuestMode = false;
			// showApp() e loadData() non dipendono l'una dall'altra: girano in parallelo
			// invece che in sequenza per dimezzare il tempo prima del primo render utile.
			await Promise.all([showApp(), loadData()]);
			if (hadGuestData) {
				await migrateGuestDataToAccount(currentUser.id);
			}
			await migrateGuestAvatar(currentUser.id);
		} else if (isGuestModeStored()) {
			// Rientra in guest mode senza ri-tracciare l'evento: è già stato tracciato
			// la prima volta che l'utente ha premuto "Prova senza registrarti".
			isGuestMode = true;
			currentUser = null;
			await Promise.all([showApp(), loadData()]);
		} else {
			showLoginPage();
			if (window.va) {
				window.va('pageview', { route: '/virtual/login-shown' });
			}
		}
	}

	let authMode = 'login'; // 'login' o 'signup': quale form ridisegnare al cambio lingua (vedi listener i18n:change)

	function showLoginPage() {
		authMode = 'login';
		document.getElementById('page-auth').classList.add('active');
		document.getElementById('header').style.display = 'none';
		document.getElementById('bottomNav')?.classList.remove('is-visible');
		document.getElementById('fabLog')?.classList.remove('is-visible');
		document.querySelectorAll('.page:not(#page-auth)').forEach(p => p.classList.remove('active'));

		const content = document.getElementById('authContent');
		content.innerHTML = `
			<form onsubmit="handleAuth(event, 'login')">
				<label for="email">${t('auth.email')}</label>
				<input type="email" id="email" placeholder="${t('auth.emailPlaceholder')}" required>

				<label for="password">${t('auth.password')}</label>
				<input type="password" id="password" placeholder="${t('auth.passwordPlaceholder')}" required>

				<button type="submit" class="main-btn">${t('auth.login')}</button>
			</form>

			<p style="text-align: center; margin-top: 20px; color: var(--color-text-secondary);">
				${t('auth.noAccount')} <button type="button" onclick="toggleAuthMode()" style="background:none; border:none; padding:0; margin:0; font:inherit; cursor:pointer; color:var(--primary-light); text-decoration:underline;" data-signup-link>${t('auth.signupLink')}</button>
			</p>
		`;
	}

	function renderSignupForm() {
		authMode = 'signup';
		const content = document.getElementById('authContent');
		content.innerHTML = `
			<form onsubmit="handleAuth(event, 'signup')">
				<label for="username">${t('auth.nickname')}</label>
				<input type="text" id="reg-username" placeholder="${t('auth.chooseNickname')}" oninput="checkLiveUsername(this)" required>
				<span id="username-status" style="font-size: 12px; font-weight: bold;"></span>

				<label for="email">${t('auth.email')}</label>
				<input type="email" id="email" placeholder="${t('auth.emailPlaceholder')}" required>

				<label for="password">${t('auth.password')}</label>
				<input type="password" id="password" placeholder="${t('auth.passwordPlaceholder')}" required>

				<label for="confirm">${t('auth.confirmPassword')}</label>
				<input type="password" id="confirm" placeholder="${t('auth.repeatPassword')}" required>

				<button type="submit" class="main-btn">${t('auth.signup')}</button>
			</form>

			<p style="text-align: center; margin-top: 20px; color: var(--color-text-secondary);">
				${t('auth.haveAccount')} <button type="button" onclick="toggleAuthMode()" style="background:none; border:none; padding:0; margin:0; font:inherit; cursor:pointer; color:var(--primary-light); text-decoration:underline;">${t('auth.loginLink')}</button>
			</p>
		`;
	}

	function toggleAuthMode() {
		const content = document.getElementById('authContent');
		if (content.querySelector('[data-signup-link]')) {
			renderSignupForm();
		} else {
			showLoginPage();
		}
	}

	// Ridisegna il form di login/registrazione quando si cambia lingua dalle bandierine
	// nella pagina di login (il form è generato con t() al render, non con data-i18n).
	document.addEventListener('i18n:change', () => {
		const authPage = document.getElementById('page-auth');
		if (authPage && authPage.classList.contains('active')) {
			authMode === 'signup' ? renderSignupForm() : showLoginPage();
		}
	});

	async function checkLiveUsername(input) {
		const username = input.value.trim();
		const statusLabel = document.getElementById('username-status');

		if (username.length < 3) {
			statusLabel.innerText = t('auth.tooShort');
			statusLabel.style.color = "orange";
			return;
		}

		if (/[<>"'`&]/.test(username)) {
			statusLabel.innerText = t('auth.noSpecialChars');
			statusLabel.style.color = "red";
			input.style.borderColor = "red";
			return;
		}

		const { data } = await supabaseClient
			.from('profiles_public')
			.select('username')
			.eq('username', username)
			.single();

		if (data) {
			statusLabel.innerText = t('auth.usernameTaken');
			statusLabel.style.color = "red";
			input.style.borderColor = "red";
		} else {
			statusLabel.innerText = t('auth.usernameAvailable');
			statusLabel.style.color = "green";
			input.style.borderColor = "green";
		}
	}

	async function handleAuth(e, mode) {
		e.preventDefault();
		const username = document.getElementById('reg-username')?.value;
		const email = document.getElementById('email').value;
		const password = document.getElementById('password').value;
		const confirm = document.getElementById('confirm')?.value;

		if (mode === 'signup' && password !== confirm) {
			showError(t('auth.passwordsMismatch'));
			return;
		}

		if (mode === 'signup' && /[<>"'`&]/.test(username || '')) {
			showError(t('auth.nicknameNoSpecialChars'));
			return;
		}

		const content = document.getElementById('authContent');
		content.innerHTML = `<div class="spinner"></div><p style="text-align: center; margin-top: 10px;">${t('auth.oneMoment')}</p>`;

		try {
			let result;
			if (mode === 'login') {
				result = await supabaseClient.auth.signInWithPassword({ email, password });
			} else {
				result = await supabaseClient.auth.signUp({ 
					email, 
					password,
					options: {
						data: { username: username }
					} 
				});
			}

			if (result.error) {
				if (result.error.message.toLowerCase().includes("profiles_username_key") ||
					result.error.message.toLowerCase().includes("unique constraint")) {
					showError(t('auth.nicknameAlreadyTaken'));
				} else if (result.error.status === 429) {
					showError(t('auth.tooManyRequests'));
				} else {
					showError(result.error.message);
				}

				if (mode === 'login') {
					showLoginPage();
				} else {
					toggleAuthMode();
					setTimeout(() => {
						if(document.getElementById('email')) document.getElementById('email').value = email;
					}, 10);
				}
				return;
			}
			// 🆕 SE È SIGNUP, MOSTRA MESSAGGIO DI CONFERMA EMAIL
if (mode === 'signup') {
	if (window.va) {
		window.va('pageview', { route: '/virtual/signup-completed' });
	}
	content.innerHTML = `
		<div style="text-align: center; padding: 30px 20px;">
			<div style="font-size: 50px; margin-bottom: 20px;">📧</div>
			<h2 style="color: var(--primary); margin-bottom: 10px;">${t('auth.confirmEmailTitle')}</h2>
			<p style="color: var(--color-text-secondary); font-size: 16px; line-height: 1.6;">
				${t('auth.confirmEmailSentTo')}<br>
				<strong style="color: var(--primary);">${email}</strong>
			</p>
			<p style="color: var(--color-text-muted); font-size: 14px; margin-top: 20px;">
				${t('auth.checkInboxAndSpam')}
			</p>
			<hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
			<p style="color: var(--color-text-secondary); font-size: 13px; margin-bottom: 20px;">
				${t('auth.didntReceiveEmail')}
			</p>
			<button onclick="toggleAuthMode()" style="background: var(--primary); color: white; border: none; padding: 12px 30px; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 14px;">
				${t('auth.backToLogin')}
			</button>
		</div>
	`;
	return;
}
			const wasGuestWithData = isGuestMode && hasGuestData();
			currentUser = result.data.user;
			isGuestMode = false;
			await initI18n();
			// in parallelo come in checkAuth(): showApp() -> loadBreaks() aspetta le sessioni
			await Promise.all([showApp(), loadData()]);
			if (wasGuestWithData) {
				await migrateGuestDataToAccount(currentUser.id);
			}
			await migrateGuestAvatar(currentUser.id);
			showMessage(t('auth.welcome'));
		} catch (err) {
			showError(err.message);
		}
	}

	async function showApp() {
		document.getElementById('page-auth').classList.remove('active');
		document.getElementById('header').style.display = 'flex';
		document.getElementById('bottomNav')?.classList.add('is-visible');
		document.getElementById('fabLog')?.classList.add('is-visible');
		showPage('home');
		document.getElementById('emailDisplay').textContent = isGuestMode ? t('guest.emailDisplay') : currentUser.email;
		document.getElementById('date').value = toDateStr(new Date());
		document.getElementById('time').value = nowTimeStr();
		updateGuestBanner();
		applyGuestModeUI();

		const defaultRadio = document.querySelector('input[name="g"][value="0.3"]');
		if(defaultRadio) {
			defaultRadio.parentElement.classList.add('selected');
		}

		if (isGuestMode) {
			// Funzionalità multi-utente/lato server non disponibili in modalità ospite:
			// niente luoghi salvati, promemoria, notifiche, obiettivi, pause tolleranza.
			// Achievement e best streak restano attivi ma salvati in locale (vedi checkAchievements/updateBestStreak).
			userPlaces = [];
			notifications = [];
			try { unlockedAchievements = JSON.parse(localStorage.getItem('jt_guest_achievements') || '[]'); } catch (e) { unlockedAchievements = []; }
			achievementsLoaded = true;
			renderAchievements();
			getLocationAuto();
			await loadPurchases();
			renderAvatarSettings();
			return;
		}

		// 🆕 AUTO GEOLOCALIZZAZIONE AL CARICAMENTO
	subscribeToNotifications();
	getLocationAuto();

	// Query indipendenti: eseguite in parallelo invece che una dopo l'altra,
	// così la home aspetta il round-trip più lento invece della somma di tutti.
	await Promise.all([
		loadPurchases(),
		loadUserPlaces(),
		loadReminderSettings(),
		loadNotifications(),
		loadAchievements(),
		loadBreaks(),
		loadGoal(),
		checkOnboarding(),
		// popola currentUserProfile (username + avatar_url) subito: la propria
		// riga in leaderboard/contributori usa currentUserProfile?.avatar_url,
		// altrimenti mancava finché non si apriva Impostazioni (unico altro
		// chiamante). Scrive anche il DOM Impostazioni (sempre presente, nascosto).
		loadUserProfile()
	]);
	// Sessioni rimaste in coda offline da un avvio precedente: ora c'e' un utente loggato.
	await flushPendingSessions();
	}

	function showError(msg) {
		const content = document.getElementById('authContent');
		const errorDiv = document.createElement('div');
		errorDiv.className = 'error';
		errorDiv.textContent = msg;
		content.insertBefore(errorDiv, content.firstChild);
	}

	function showMessage(msg) {
		document.getElementById('notif').textContent = msg;
		document.getElementById('notif').style.display = 'block';
		setTimeout(() => document.getElementById('notif').style.display = 'none', 2000);
	}

	// ========== OFFLINE: rilevamento e banner ==========
function updateOnlineStatus() {
	isOnline = navigator.onLine;
	const banner = document.getElementById('offlineBanner');
	if (!banner) return;
	banner.style.display = isOnline ? 'none' : 'block';

	if (isOnline) {
		flushPendingSessions();
	}
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ========== OFFLINE: cache locale degli ultimi dati caricati ==========
function cacheLocalData(key, data) {
	try {
		localStorage.setItem('jt_cache_' + key, JSON.stringify(data));
	} catch (e) {
		console.log('Impossibile salvare cache locale:', e);
	}
}

function getLocalCache(key) {
	try {
		const raw = localStorage.getItem('jt_cache_' + key);
		return raw ? JSON.parse(raw) : null;
	} catch (e) {
		return null;
	}
}

// ========== OFFLINE: coda di sessioni non ancora sincronizzate ==========
function getPendingSessions() {
	try {
		const raw = localStorage.getItem('jt_pending_sessions');
		return raw ? JSON.parse(raw) : [];
	} catch (e) {
		return [];
	}
}

function addPendingSession(payload) {
	const pending = getPendingSessions();
	pending.push(payload);
	localStorage.setItem('jt_pending_sessions', JSON.stringify(pending));
}

async function flushPendingSessions() {
	// Serve un utente loggato: all'avvio updateOnlineStatus() gira prima di checkAuth() e
	// l'insert senza sessione veniva respinto dalla RLS (showApp() richiama il flush dopo il login).
	if (!currentUser || isGuestMode) return;
	const pending = getPendingSessions();
	if (pending.length === 0) return;

	showMessage(tn('sync.syncingSessions', pending.length));

	const stillFailed = [];
	let synced = 0;
	for (const payload of pending) {
		const { error } = await supabaseClient.from('smokes').insert(payload);
		// 23505 = unique(user_id, ts): la sessione e' gia' sul server (flush precedente
		// interrotto dopo l'insert), non va ritentata all'infinito.
		if (!error || error.code === '23505') synced++;
		else stillFailed.push(payload);
	}

	localStorage.setItem('jt_pending_sessions', JSON.stringify(stillFailed));

	if (stillFailed.length === 0) showMessage(t('sync.allSynced'));
	else showMessage(tn('sync.syncFailedRetry', stillFailed.length));

	if (synced > 0) {
		await loadData();
		// Una sessione arrivata dalla coda offline deve chiudere una pausa attiva come
		// farebbe saveData() (loadBreaks() confronta la pausa con le sessioni caricate).
		await loadBreaks();
	}
}

	// ========== MODALITA' OSPITE: storage locale ==========
	const GUEST_MODE_KEY = 'jt_guest_mode';
	const GUEST_SMOKES_KEY = 'jt_guest_smokes';
	const GUEST_PURCHASES_KEY = 'jt_guest_purchases';

	function isGuestModeStored() {
		try { return localStorage.getItem(GUEST_MODE_KEY) === '1'; } catch (e) { return false; }
	}

	function hasGuestData() {
		return getGuestSmokes().length > 0 || getGuestPurchases().length > 0;
	}

	function getGuestSmokes() {
		try {
			const raw = localStorage.getItem(GUEST_SMOKES_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch (e) { return []; }
	}

	function setGuestSmokes(arr) {
		localStorage.setItem(GUEST_SMOKES_KEY, JSON.stringify(arr));
	}

	function getGuestPurchases() {
		try {
			const raw = localStorage.getItem(GUEST_PURCHASES_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch (e) { return []; }
	}

	function setGuestPurchases(arr) {
		localStorage.setItem(GUEST_PURCHASES_KEY, JSON.stringify(arr));
	}

	// Id locale univoco per record creati in guest mode: sempre positivo,
	// generato da timestamp+contatore per evitare collisioni se due salvataggi
	// capitano nello stesso millisecondo (es. tap rapidi).
	let guestIdCounter = 0;
	function genGuestId() {
		guestIdCounter++;
		return Date.now() * 1000 + (guestIdCounter % 1000);
	}

	function updateGuestBanner() {
		const banner = document.getElementById('guestModeBanner');
		if (banner) banner.style.display = isGuestMode ? 'block' : 'none';
	}

	// Mostra/nasconde le funzionalità non disponibili in modalità ospite (sessioni condivise,
	// foto, social, promemoria/push, backup) e la card di conversione account nelle Impostazioni.
	function applyGuestModeUI() {
		const setVisible = (id, visible) => {
			const el = document.getElementById(id);
			if (el) el.style.display = visible ? '' : 'none';
		};

		setVisible('sharedSessionFeature', !isGuestMode);
		setVisible('sharedSessionLocked', isGuestMode);
		setVisible('photoFeature', !isGuestMode);
		setVisible('photoLocked', isGuestMode);

		setVisible('profileCard', true);                 // sempre visibile: i guest ci scelgono un preset
		setVisible('profileIdentityBlock', !isGuestMode); // email + nickname solo per account registrati
		setVisible('guestConvertCard', isGuestMode);
		setVisible('remindersPushCard', !isGuestMode);
		setVisible('remindersPushLocked', isGuestMode);
		setVisible('backupCard', !isGuestMode);
		setVisible('backupLocked', isGuestMode);

		setVisible('socialContent', !isGuestMode);
		setVisible('socialLocked', isGuestMode);

		setVisible('galleryCard', !isGuestMode);
		setVisible('galleryLocked', isGuestMode);

		const logoutBtn = document.getElementById('logoutBtn');
		if (logoutBtn) logoutBtn.textContent = isGuestMode ? t('guest.exitToLogin') : t('settings.logout');
	}

	// Il cambio lingua ri-applica le traduzioni statiche (data-i18n) e sovrascriverebbe
	// il testo del bottone logout impostato via JS in applyGuestModeUI(): lo riallineiamo.
	document.addEventListener('i18n:change', () => applyGuestModeUI());

	async function enterGuestMode() {
		isGuestMode = true;
		try { localStorage.setItem(GUEST_MODE_KEY, '1'); } catch (e) {}
		currentUser = null;
		await initI18n();
		if (window.va) {
			window.va('pageview', { route: '/virtual/guest-mode-started' });
		}
		await showApp();
		await loadData();
	}

	// Torna alla schermata di login mantenendo i dati locali (non li cancella):
	// l'utente può rientrare in modalità ospite in qualsiasi momento e ritrovarli.
	function exitGuestMode() {
		isGuestMode = false;
		try { localStorage.removeItem(GUEST_MODE_KEY); } catch (e) {}
		smokes = [];
		smokesLoaded = false;
		smokesSettled = false;
		purchases = [];
		updateGuestBanner();
		showLoginPage();
	}

	async function logout() {
		if (isGuestMode) {
			exitGuestMode();
			return;
		}
		await supabaseClient.auth.signOut();
		currentUser = null;
		smokes = [];
		smokesLoaded = false;
		smokesSettled = false;
		activeBreak = null;
		pendingBreak = null;
		allBreaks = [];
		showLoginPage();
	}

	// Porta l'utente ospite alla schermata di registrazione senza toccare i dati locali:
	// se abbandona il form può tornare in modalità ospite e ritrovare tutto.
	function startGuestConversion() {
		showLoginPage();
		toggleAuthMode();
	}

	// Chiamata dopo che l'utente, precedentemente in modalità ospite, ottiene una sessione
	// Supabase valida (signup con autologin, oppure primo login dopo conferma email).
	// Copia smokes/purchases locali su Supabase con lo user_id reale, poi ripulisce il locale
	// SOLO se tutto è andato a buon fine: in caso di errore i dati restano (duplicati temporanei
	// preferibili a una perdita) e si riprova al prossimo login.
	async function migrateGuestDataToAccount(userId) {
		if (!hasGuestData()) {
			try { localStorage.removeItem(GUEST_MODE_KEY); } catch (e) {}
			return;
		}

		const guestSmokes = getGuestSmokes();
		const guestPurchases = getGuestPurchases();

		const loadingTimer = setTimeout(() => {
			showMessage(t('guest.migrating'));
		}, 1000);

		try {
			if (guestSmokes.length > 0) {
				const payload = guestSmokes.map(({ id, ...rest }) => ({ ...rest, user_id: userId }));
				// ignoreDuplicates: se un tentativo precedente aveva gia' inserito le sessioni ma era
				// fallito sugli acquisti, il retry non deve fermarsi su unique(user_id, ts) per sempre.
				const { error } = await supabaseClient.from('smokes').upsert(payload, { onConflict: 'user_id,ts', ignoreDuplicates: true });
				if (error) throw error;
			}

			if (guestPurchases.length > 0) {
				const payload = guestPurchases.map(({ id, ...rest }) => ({ ...rest, user_id: userId }));
				const { error } = await supabaseClient.from('purchases').insert(payload);
				if (error) throw error;
			}

			// Tutto migrato con successo: ripuliamo solo i dati guest, non le preferenze (tema/lingua).
			setGuestSmokes([]);
			setGuestPurchases([]);
			try {
				localStorage.removeItem(GUEST_MODE_KEY);
				localStorage.removeItem('jt_guest_achievements');
				localStorage.removeItem('jt_guest_best_streak');
			} catch (e) {}

			clearTimeout(loadingTimer);
			showMessage(t('guest.migrationSuccess'));
			if (window.va) {
				window.va('pageview', { route: '/virtual/guest-converted' });
			}

			await loadData();
			await loadPurchases();
			await loadBreaks(); // le sessioni migrate possono chiudere una pausa attiva dell'account
		} catch (err) {
			clearTimeout(loadingTimer);
			console.error('Errore migrazione dati guest:', err);
			showMessage(t('guest.migrationError'));
		}
	}

	// ========== CARICAMENTO DATI ==========
	// loadBreaks() gira in parallelo a loadData() (vedi showApp): se arrivava prima, rilevava
	// le pause e classificava il consumo su smokes = [] (niente rilevamento, elevated_since
	// azzerato). whenSmokesSettled() lo fa aspettare finche' loadData() non ha finito.
	let smokesSettleWaiters = [];
	let smokesSettled = false;
	let smokesLoadInFlight = false;

	function markSmokesSettled(loaded) {
		if (loaded) smokesLoaded = true;
		smokesSettled = true;
		const waiters = smokesSettleWaiters;
		smokesSettleWaiters = [];
		waiters.forEach(resolve => resolve());
	}

	function whenSmokesSettled() {
		if (smokesSettled) return Promise.resolve();
		const wait = new Promise(resolve => smokesSettleWaiters.push(resolve));
		// Rete di sicurezza: se nessuno sta caricando le sessioni, parte il caricamento qui
		// (altrimenti chi attende prima di chiamare loadData() resterebbe bloccato). Al tick
		// successivo: in Promise.all([showApp(), loadData()]) loadData() parte subito dopo e
		// non va duplicato.
		setTimeout(() => { if (!smokesSettled && !smokesLoadInFlight) loadData(); }, 0);
		return wait;
	}

	// Tutte le sessioni dell'utente, a pagine: PostgREST tronca una select a max-rows righe
	// (default 1000) e oltre quella soglia totali, medie, record e Wrapped avrebbero perso le
	// sessioni piu' vecchie. Ordine deterministico (ts e' unico per utente) per il range.
	async function fetchAllSmokes() {
		const PAGE = 1000;
		const query = (from, to, withCount) => supabaseClient
			.from('smokes')
			.select('*', withCount ? { count: 'exact' } : undefined)
			.order('ts', { ascending: false })
			.order('id', { ascending: false })
			.range(from, to);

		const first = await query(0, PAGE - 1, true);
		if (first.error) return first;
		let rows = first.data || [];
		const total = first.count ?? rows.length;
		const pageSize = rows.length;
		while (pageSize > 0 && rows.length < total) {
			const next = await query(rows.length, rows.length + pageSize - 1, false);
			if (next.error) return next;
			if (!next.data || next.data.length === 0) break;
			rows = rows.concat(next.data);
		}
		return { data: rows, error: null };
	}

	async function loadData() {
		if (isGuestMode) {
			smokes = getGuestSmokes().slice().sort((a, b) => b.ts - a.ts);
			markSmokesSettled(true);
			update({ deferHeavy: true });
			return;
		}
		smokesLoadInFlight = true;
		let res;
		try {
			res = await fetchAllSmokes();
		} catch (e) {
			res = { data: null, error: e };
		} finally {
			smokesLoadInFlight = false;
		}
		const { data, error } = res;

		if (error) {
			console.error('Errore caricamento dati:', error);
			const cached = getLocalCache('smokes');
			if (cached) {
				smokes = cached;
				markSmokesSettled(true);
				update({ deferHeavy: true });
				showMessage(t('sync.offlineDataStale'));
			} else {
				markSmokesSettled(false);
			}
			return;
		}

		smokes = data || [];
		markSmokesSettled(true);
		cacheLocalData('smokes', smokes);
		update({ deferHeavy: true });
	}

	// ========== SALVATAGGIO DATI ==========
	async function saveData() {
	if (isLocatingNow) {
		if (!confirm(t('add.stillLocatingConfirm'))) return;
	}
	const hasFumo = document.getElementById("fumo").checked;
	const hasErba = document.getElementById("erba").checked;

	if (!hasFumo && !hasErba) {
		return alert(t('add.selectSmokeOrWeed'));
	}

	let fumo_grams = 0;
	let erba_grams = 0;

	if (hasFumo && hasErba) {
		fumo_grams = parseFloat(document.getElementById("fumoGramsInput").value) || 0;
		erba_grams = parseFloat(document.getElementById("erbaGramsInput").value) || 0;
		if (fumo_grams <= 0 && erba_grams <= 0) {
			return alert(t('add.enterAtLeastOneQuantity'));
		}
	} else {
		const gVal = document.querySelector('input[name="g"]:checked').value;
		const grams = gVal === "custom" ? parseFloat(document.getElementById("customGrams").value) : parseFloat(gVal);
		if(!grams || grams <= 0) return alert(t('add.enterValidWeight'));
		if (hasFumo) fumo_grams = grams; else erba_grams = grams;
	}

	const date = document.getElementById("date").value;
	const time = document.getElementById("time").value || nowTimeStr();
	const ts = Date.now();

	let finalLocationName = currentLocation.name || null;
	if (currentLocation.lat && currentLocation.lng && typeof userPlaces !== 'undefined') {
		userPlaces.forEach(p => {
			const d = getDist(currentLocation.lat, currentLocation.lng, p.latitude, p.longitude);
			if (d <= (p.radius || 50)) finalLocationName = p.name;
		});
	}

	const contextTag = document.querySelector('input[name="contextTag"]:checked')?.value || null;
	const moodRatingRaw = document.querySelector('input[name="moodRating"]:checked')?.value || '';
	const moodRating = moodRatingRaw ? parseInt(moodRatingRaw) : null;

	let photoPath = null;
	if (selectedPhotoFile && !isGuestMode) {
		if (navigator.onLine) {
			photoPath = await uploadSessionPhoto(ts);
			if (!photoPath) showMessage(t('add.photoNotUploaded'));
		} else {
			showMessage(t('add.offlinePhotoNotAttached'));
		}
	}

	const isShared = !isGuestMode && document.getElementById('sharedSessionCheck')?.checked && sessionParticipants.length > 0;

	if (isGuestMode) {
		const payload = {
			id: genGuestId(),
			type: (hasFumo && hasErba) ? "fumo-erba" : (hasFumo ? "fumo" : "erba"),
			grams: fumo_grams + erba_grams,
			fumo_grams, erba_grams,
			my_fumo_grams: fumo_grams,
			my_erba_grams: erba_grams,
			date, time, ts,
			latitude: currentLocation.lat || null,
			longitude: currentLocation.lng || null,
			location_name: finalLocationName,
			not_mine: document.getElementById("notMineCheck").checked,
			context_tag: contextTag,
			mood_rating: moodRating,
			photo_path: null,
		};
		const guestSmokes = getGuestSmokes();
		guestSmokes.push(payload);
		setGuestSmokes(guestSmokes);
	} else if (isShared) {
		const all = [{ user_id: currentUser.id }, ...sessionParticipants];
		const fumoContribs = Array.from(document.querySelectorAll('.contrib-fumo:checked')).map(el => el.value);
		const erbaContribs = Array.from(document.querySelectorAll('.contrib-erba:checked')).map(el => el.value);

		const fumoAmounts = {};
		document.querySelectorAll('.contrib-fumo-amt').forEach(el => {
			fumoAmounts[el.dataset.user] = parseFloat(el.value) || 0;
		});
		const erbaAmounts = {};
		document.querySelectorAll('.contrib-erba-amt').forEach(el => {
			erbaAmounts[el.dataset.user] = parseFloat(el.value) || 0;
		});

		const participants = all.map(p => ({
			user_id: p.user_id,
			fumo_grams: fumoContribs.includes(p.user_id) ? (fumoAmounts[p.user_id] || 0) : 0,
			erba_grams: erbaContribs.includes(p.user_id) ? (erbaAmounts[p.user_id] || 0) : 0,
			my_fumo_grams: fumo_grams,
			my_erba_grams: erba_grams,
			not_mine: !fumoContribs.includes(p.user_id) && !erbaContribs.includes(p.user_id)
		}));

		const { error } = await supabaseClient.rpc('create_shared_session', {
			p_date: date, p_time: time, p_ts: ts,
			p_latitude: currentLocation.lat || null,
			p_longitude: currentLocation.lng || null,
			p_location_name: finalLocationName,
			p_participants: participants,
			p_context_tag: contextTag,
			p_mood_rating: moodRating,
			p_photo_path: photoPath
		});

		if (error) {
			console.error('Errore salvataggio condiviso:', error);
			alert(t('add.sharedSessionSaveError'));
			return;
		}
	} else {
		const payload = {
			type: (hasFumo && hasErba) ? "fumo-erba" : (hasFumo ? "fumo" : "erba"),
			grams: fumo_grams + erba_grams,
			fumo_grams, erba_grams,
			my_fumo_grams: fumo_grams,
			my_erba_grams: erba_grams,
			date, time, ts,
			user_id: currentUser.id,
			latitude: currentLocation.lat || null,
			longitude: currentLocation.lng || null,
			location_name: finalLocationName,
			not_mine: document.getElementById("notMineCheck").checked,
			context_tag: contextTag,
			mood_rating: moodRating,
			photo_path: photoPath,
		};

		if (!navigator.onLine) {
			addPendingSession(payload);
			showMessage(t('add.offlineSessionSavedLocally'));
		} else {
			const { error } = await supabaseClient.from('smokes').insert(payload);

			if (error) {
				// rete instabile: non perdere la sessione, mettila in coda
				addPendingSession(payload);
				showMessage(t('add.unstableConnectionSavedLocally'));
			}
		}
	}

	showMessage(t('add.sessionSaved'));
	document.getElementById("fumo").checked = false;
	document.getElementById("erba").checked = false;
	document.getElementById("notMineCheck").checked = false;
	document.getElementById("notMineToggle").style.display = "none";
	document.querySelectorAll('.substance-checkbox-group label').forEach(l => l.classList.remove('selected'));
	const defaultContextTag = document.querySelector('input[name="contextTag"][value=""]');
	if (defaultContextTag) defaultContextTag.checked = true;
	document.querySelectorAll('input[name="moodRating"]').forEach(r => { r.checked = false; });
	syncTagRowVisual('contextTag');
	syncTagRowVisual('moodRating');
	clearSelectedPhoto();
	sessionParticipants = [];
	document.getElementById('sharedSessionCheck').checked = false;
	document.getElementById('sharedSessionPanel').style.display = 'none';
	renderParticipantChips();
	
	await loadData();
	getLocationAuto();

	// Dopo loadData(): "smokes" è fresco, così runBreakDetection() (chiamata da loadBreaks()
	// dentro handleSessionLoggedForBreaks) calcola il gap sull'ultima sessione vera, non su
	// dati stantii che potrebbero far ricreare erroneamente una pausa appena chiusa.
	if (!isGuestMode) {
		await handleSessionLoggedForBreaks(date);
	}
}
	async function deleteItem(ts) {
		if(!confirm(t('history.confirmDeleteEntry'))) return;

		if (isGuestMode) {
			setGuestSmokes(getGuestSmokes().filter(s => s.ts !== ts));
			await loadData();
			return;
		}

		const { error } = await supabaseClient.from('smokes').delete().eq('ts', ts);

		if (error) {
			console.error('Errore eliminazione:', error);
			return;
		}

		await loadData();
	}

	// 1. Funzione per salvare un nuovo posto preferito
async function addNewPlace() {
    const nameInput = document.getElementById('newPlaceName');
    const name = nameInput.value.trim();
    
    if (!name) {
        return alert(t('places.enterPlaceName'));
    }

    if (!currentLocation.lat || !currentLocation.lng) {
        return alert(t('places.needGpsFirst'));
    }

    const { error } = await supabaseClient.from('places').insert({
        name: name,
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        user_id: currentUser.id
    });

    if (error) {
        console.error('Errore salvataggio posto:', error);
        alert(t('places.saveError'));
    } else {
        nameInput.value = "";
        showMessage(t('places.saved'));
        await loadUserPlaces(); // Ricarica la lista per vederlo subito
    }
}

	function toggleAdvancedSearch() {
    const panel = document.getElementById('advancedPlaceSearch');
    const btn = document.getElementById('btnToggleAdvanced');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    btn.textContent = isVisible ? t('places.searchOnMap') : t('places.closeMap');
    if (!isVisible) {
        loadMapLibs().then(() => setTimeout(() => initAddPlaceMap(), 150));
    }
}

	
// 2. Funzione per caricare i posti dal database
async function loadUserPlaces() {
    if (!currentUser) return;
    
    const { data, error } = await supabaseClient
        .from('places')
        .select('*')
        .order('name', { ascending: true });

    if (!error) {
        userPlaces = data || [];
        renderUserPlaces();
    }
}

// 3. Funzione per mostrare la lista nell'interfaccia
function renderUserPlaces() {
    const list = document.getElementById('userPlacesList');
    if (!list) return;

    if (userPlaces.length === 0) {
        list.innerHTML = `<p style="font-size: 12px; color: var(--color-text-muted); text-align: center;">${t('places.noPlacesSaved')}</p>`;
        return;
    }

    list.innerHTML = userPlaces.map(p => `
        <div class="place-row">
            <span class="place-ico">📍</span>
            <span class="place-name">${escapeHtml(p.name)}</span>
            <button class="place-del" onclick="deletePlace(${p.id})" aria-label="${t('places.confirmDeletePlace')}">🗑️</button>
        </div>
    `).join('');
}

// 4. Funzione per eliminare un posto
async function deletePlace(id) {
    if (!confirm(t('places.confirmDeletePlace'))) return;

    const { error } = await supabaseClient
        .from('places')
        .delete()
        .eq('id', id);

    if (!error) {
        await loadUserPlaces();
    }
}

	// ========== GEOLOCALIZZAZIONE ==========
	function getLocation() {
		if (!navigator.geolocation) {
			alert(t('places.geolocationNotSupported'));
			return;
		}

		const btn = event.target;
		btn.disabled = true;
		btn.textContent = t('places.locatingShort');
		showMessage(t('add.searchingLocation'));

		navigator.geolocation.getCurrentPosition(
			async (position) => {
				const lat = position.coords.latitude;
				const lng = position.coords.longitude;

				currentLocation = { lat, lng, name: null };

				const displayEl = document.getElementById('locationDisplay');
				if (displayEl) {
					displayEl.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
				}

				try {
					const response = await fetch(
						`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
					);
					const data = await response.json();

					if (data.address) {
						const city = data.address.city || data.address.town || data.address.village || t('places.unknownLocation');
						currentLocation.name = city;
						if (displayEl) {
							displayEl.value = city;
						}
					}
				} catch (err) {
					console.log("Reverse geocoding non disponibile");
				}

				showMessage(t('places.locationSaved'));
				btn.disabled = false;
				btn.textContent = t('add.getLocation');
			},
			(error) => {
				console.error("Errore geolocalizzazione:", error);
				alert(t('places.locationError', { message: error.message }));
				btn.disabled = false;
				btn.textContent = t('add.getLocation');
			}
		);
	}
function getLocationAuto() {
	if (!navigator.geolocation) {
		return;
	}

	// 🆕 MOSTRA CHE STA CERCANDO
	const displayEl = document.getElementById('locationDisplay');
	displayEl.value = t('add.searchingLocation');
	displayEl.style.color = "#FF9800";

	navigator.geolocation.getCurrentPosition(
		async (position) => {
			const lat = position.coords.latitude;
			const lng = position.coords.longitude;

			currentLocation = { lat, lng, name: null };
			displayEl.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
			displayEl.style.color = "#2e7d32"; // Verde quando trovata

			let recognizedPlace = null;
if (userPlaces && userPlaces.length > 0) {
    userPlaces.forEach(p => {
        const d = getDist(lat, lng, p.latitude, p.longitude);
        if (d <= 50) {
            recognizedPlace = p.name;
        }
    });
}

if (recognizedPlace) {
    currentLocation.name = recognizedPlace;
    displayEl.value = "📍 " + recognizedPlace;
    displayEl.style.color = "#2e7d32";
} else {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await response.json();

        if (data.address) {
            const city = data.address.city || data.address.town || data.address.village || t('places.locationFallback');
            currentLocation.name = city;
            displayEl.value = city;
        }
    } catch (err) {
        console.log("Reverse geocoding non disponibile");
    }
}
		},
		(error) => {
			displayEl.value = t('places.locatingError'); // Rosso se errore
			displayEl.style.color = "#ff3b30";
			console.log("Geolocalizzazione: " + error.message);
		}
	);
}

	function getDist(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Raggio Terra in metri
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

	
	async function fixOldSessions() {
    const statusEl = document.getElementById('fixStatus');
    statusEl.textContent = t('places.checkingInProgress');

    if (userPlaces.length === 0) {
        statusEl.textContent = t('places.noPlacesForReference');
        return;
    }

    let updated = 0;
    let toUpdate = [];

    smokes.forEach(s => {
        if (!s.latitude || !s.longitude) return;

        userPlaces.forEach(p => {
            const d = getDist(s.latitude, s.longitude, p.latitude, p.longitude);
            if (d <= 50 && s.location_name !== p.name) {
                toUpdate.push({ id: s.id, newName: p.name });
            }
        });
    });

    if (toUpdate.length === 0) {
        statusEl.textContent = t('places.noSessionsToUpdate');
        return;
    }

    for (const item of toUpdate) {
        const { error } = await supabaseClient
            .from('smokes')
            .update({ location_name: item.newName })
            .eq('id', item.id);

        if (!error) updated++;
    }

    await loadData();
    statusEl.textContent = tn('places.sessionsUpdated', updated);
    showMessage(tn('places.sessionsUpdated', updated));
}

	let addPlaceMapInstance = null;
let addPlaceMarker = null;
let selectedPinLocation = { lat: null, lng: null };

function initAddPlaceMap() {
    if (addPlaceMapInstance) return; // già inizializzata

    addPlaceMapInstance = L.map('addPlaceMap').setView([45.07, 7.68], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(addPlaceMapInstance);

    // Click sulla mappa → piazza il pin
    addPlaceMapInstance.on('click', function(e) {
        placePin(e.latlng.lat, e.latlng.lng);
    });
}

function placePin(lat, lng) {
    if (addPlaceMarker) addPlaceMapInstance.removeLayer(addPlaceMarker);

    addPlaceMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            html: `<div style="background:#2e7d32; width:32px; height:32px; border-radius:50%; 
                              display:flex; align-items:center; justify-content:center; 
                              font-size:18px; border:3px solid white; 
                              box-shadow:0 2px 8px rgba(0,0,0,0.3);">📌</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        })
    }).addTo(addPlaceMapInstance);

    selectedPinLocation = { lat, lng };
    document.getElementById('selectedPinInfo').style.display = 'block';
    document.getElementById('selectedPinInfo').textContent = `📌 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('btnSaveFromMap').style.display = 'block';
}

async function searchAddress() {
    const query = document.getElementById('searchAddressInput').value.trim();
    if (!query) return alert(t('places.enterAddress'));

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
        );
        const data = await response.json();

        if (!data || data.length === 0) {
            return alert(t('places.addressNotFound'));
        }

        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        addPlaceMapInstance.setView([lat, lng], 17);
        placePin(lat, lng);

        document.getElementById('selectedPinInfo').textContent = `📌 ${data[0].display_name.split(',').slice(0,3).join(',')}`;
    } catch (err) {
        alert(t('places.searchError'));
    }
}

async function addPlaceFromMap() {
    const name = document.getElementById('newPlaceName').value.trim();
    if (!name) return alert(t('places.enterPlaceNameFirst'));
    if (!selectedPinLocation.lat) return alert(t('places.selectPointFirst'));

    const { error } = await supabaseClient.from('places').insert({
        name: name,
        latitude: selectedPinLocation.lat,
        longitude: selectedPinLocation.lng,
        user_id: currentUser.id
    });

    if (error) {
        alert(t('places.saveError'));
    } else {
        document.getElementById('newPlaceName').value = "";
        document.getElementById('searchAddressInput').value = "";
        document.getElementById('selectedPinInfo').style.display = 'none';
        document.getElementById('btnSaveFromMap').style.display = 'none';
        if (addPlaceMarker) addPlaceMapInstance.removeLayer(addPlaceMarker);
        selectedPinLocation = { lat: null, lng: null };
        showMessage(t('places.saved'));
        await loadUserPlaces();
    }
}
	
	// ========== NAVIGAZIONE PAGINE ==========
	// Redesign 2026: barra inferiore (#bottomNav) con 5 slot Home / Registro /
	// (FAB centro) / Stats / Altro. Le pagine non presenti nella barra
	// (goals, charts, gallery, map, social, stock, settings) illuminano "Altro".
	const BOTTOM_NAV_PAGES = ['home', 'history', 'stats', 'more'];

	function setActiveBottomTab(p) {
		// 'add' (raggiunta dal FAB) non illumina nessun tab; le altre pagine
		// fuori dalla barra illuminano "Altro".
		const target = p === 'add' ? null : (BOTTOM_NAV_PAGES.includes(p) ? p : 'more');
		document.querySelectorAll('#bottomNav .bn-item[data-page]').forEach(btn => {
			btn.classList.toggle('is-active', btn.dataset.page === target);
		});
		const fab = document.getElementById('fabLog');
		if (fab) fab.classList.toggle('is-active', p === 'add');
		// Sul frame "nuovo inserimento" (handoff 2b) la barra tab + FAB spariscono
		// e lasciano il posto alla barra sticky "SALVA SESSIONE" (.save-bar).
		document.getElementById('bottomNav')?.classList.toggle('nav-hidden-for-add', p === 'add');
		if (fab) fab.classList.toggle('nav-hidden-for-add', p === 'add');
	}

	function showPage(p) {
		document.querySelectorAll(".page").forEach(pg => pg.classList.remove("active"));
		const pageEl = document.getElementById("page-" + p);
		if (!pageEl) return;
		pageEl.classList.add("active");
		// riavvia le animazioni d'ingresso a ogni entrata nella pagina
		void pageEl.offsetWidth;

		setActiveBottomTab(p);
		// il menu dropdown non esiste più; nessun altro reset necessario

		refreshPageDynamicContent(p);
	}

	// Ricarica i dati/render dinamici di una pagina. Estratto da showPage() così può essere
	// richiamato anche al cambio lingua, per aggiornare il testo generato via JS senza reload.
	function refreshPageDynamicContent(p) {
		if (p === 'more') renderMorePage();
		if (p === 'stats') statsAnimateOnce = true;
		if (p === 'home') homeAnimateOnce = true;
		if (p === 'gallery' && !isGuestMode) loadGallery();

		if (p === 'map') {
			loadUserPlaces();
			loadMapLibs().then(() => {
				setTimeout(() => {
					initMap();
					updateMap();
				}, 100);
			});
		}

		if (p === 'social' && !isGuestMode) {
			loadSocial();
			loadFriendRequests();
			const feedOpen = !feedCollapsedPref();
			toggleSnapshotFeed(feedOpen);
			if (feedOpen) loadFeed(); // lazy: se la sezione è chiusa il feed si carica solo all'apertura
		}
		if (p === 'stock' || p === 'charts') loadPurchases();
		if (p === 'charts') loadChartJs().then(renderCharts);
		if (p === 'settings') {
		    applyGuestModeUI();
		    if (!isGuestMode) {
		        loadUserProfile();
		        loadReminderSettings();
		        loadPushDevices();
		        loadBackupStatus();
		    }
		}
		update();
	}

	function getCurrentPageName() {
		const activePage = document.querySelector('.page.active');
		return activePage ? activePage.id.replace('page-', '') : null;
	}

	// Abilita le animazioni d'ingresso delle card (CSS: :root.anim-ready .page.active > .card)
	// solo quando il documento è davvero visibile. Se l'app viene avviata in background
	// (PWA che pre-carica all'apertura, tab non a fuoco) una jtRise con fill "both" da
	// opacity:0 resterebbe bloccata a 0% e la Home resterebbe vuota finché non si cambia
	// pagina e si torna indietro. Idempotente; ri-tentato a ogni visibilitychange.
	function armEntranceAnimations() {
		const root = document.documentElement;
		if (root.classList.contains('anim-ready')) return;
		if (document.visibilityState !== 'visible') return;
		root.classList.add('anim-ready');
	}
	document.addEventListener('visibilitychange', armEntranceAnimations);

	// ========== PAGINA "ALTRO" (redesign 2026) ==========
	// Sostituisce il dropdown hamburger. Griglia di 6 destinazioni + lista
	// Impostazioni/Notifiche, ognuna con un numero "live" derivato dai dati
	// già in memoria (nessuna nuova chiamata di rete).
	function renderMorePage() {
		// pill utente
		const nameEl = document.getElementById('moreUserName');
		const avEl = document.getElementById('moreUserAvatar');
		if (nameEl) {
			const uname = isGuestMode
				? t('guest.emailDisplay')
				: (currentUserProfile?.username || currentUser?.email || '–');
			nameEl.textContent = uname;
			if (avEl) avEl.innerHTML = avatarMarkup(
				isGuestMode ? null : currentUserProfile?.avatar_url,
				uname, 30
			);
		}

		const setSub = (id, txt) => { const el = document.getElementById(id); if (el && txt) el.textContent = txt; };

		// Obiettivi: se c'è una pausa attiva mostra il giorno, altrimenti il numero di obiettivi attivi
		if (activeBreak && activeBreak.start_date) {
			// giorno in corso della pausa (1 = giorno di inizio): stessa base di calendario della Home
			const day = daysBetween(activeBreak.start_date, todayStr()) + 1;
			setSub('moreGoalsSub', t('more.goalsBreak', { day: Math.max(1, day) }));
		} else if (typeof activeGoal !== 'undefined' && activeGoal) {
			setSub('moreGoalsSub', tn('more.goalsCount', 1, { count: 1 }));
		} else {
			setSub('moreGoalsSub', t('more.goalsSubtitle'));
		}

		// Grafici
		setSub('moreChartsSub', t('more.chartsMonths'));

		// Galleria: numero di istantanee (righe smokes con photo_path)
		const snapCount = smokes.filter(s => s.photo_path).length;
		setSub('moreGallerySub', snapCount > 0 ? tn('more.snapshotsCount', snapCount, { count: snapCount }) : t('more.gallerySubtitle'));

		// Luoghi
		const placesCount = Array.isArray(userPlaces) ? userPlaces.length : 0;
		setSub('morePlacesSub', placesCount > 0 ? tn('more.placesCount', placesCount, { count: placesCount }) : t('more.placesSubtitle'));

		// Social: rank globale se già calcolato da una visita a Social
		setSub('moreSocialSub', lastGlobalRank
			? t('more.rank', { rank: lastGlobalRank.rank, total: lastGlobalRank.total })
			: t('more.socialSubtitle'));

		// Scorte: grammi totali rimanenti (fumo + erba)
		let stockLeft = 0;
		try {
			['fumo', 'erba'].forEach(type => {
				getOpenPurchasesFIFO(type).forEach(p => { stockLeft += gramsRemainingForPurchase(p); });
			});
		} catch (e) { stockLeft = 0; }
		setSub('moreStockSub', stockLeft > 0
			? t('more.stockLeft', { grams: fmtNum(stockLeft, 1) })
			: t('more.stockEmpty'));

		// Pill conteggio notifiche non lette
		const unread = notifications.filter(n => !n.read).length;
		const pill = document.getElementById('moreNotifCount');
		const chevron = document.getElementById('moreNotifChevron');
		if (pill) {
			pill.textContent = unread;
			pill.style.display = unread > 0 ? 'inline-block' : 'none';
		}
		if (chevron) chevron.style.display = unread > 0 ? 'none' : 'grid';
	}

	// ========== STATS: filtro periodo (redesign 2026) ==========
	// Primo giorno ("YYYY-MM-DD", incluso) di un periodo '30d' (30 giorni di calendario, oggi
	// compreso) / 'year' (ultimi 365 giorni, non anno solare) / 'all' (null). Condiviso con la
	// sezione "Insieme" del popup amico. Prima era "oggi − 30" = 31 giorni (audit F-15).
	function periodStartDate(period) {
		if (period === 'all') return null;
		return shiftDateStr(todayStr(), period === '30d' ? -29 : -364);
	}

	// Sessioni del periodo attivo del toggle Stats. Confronto fra stringhe di data: new Date(s.date)
	// e' la mezzanotte UTC (01:00/02:00 a Roma) ed escludeva le sessioni di oggi fra 00:00 e 02:00.
	function smokesForStatsPeriod() {
		const from = periodStartDate(statsPeriod);
		if (!from) return smokes;
		const today = todayStr();
		return smokes.filter(s => s.date >= from && s.date <= today);
	}

	function setStatsPeriod(period) {
		if (!['30d', 'year', 'all'].includes(period)) return;
		statsPeriod = period;
		statsAnimateOnce = true;
		document.querySelectorAll('#statsPeriodToggle button').forEach(b => {
			b.classList.toggle('is-active', b.dataset.period === period);
		});
		const lbl = document.getElementById('statsPeriodLabel');
		if (lbl) {
			const key = period === '30d' ? 'stats.periodLabel30d' : period === 'year' ? 'stats.periodLabelYear' : 'stats.periodLabelAll';
			lbl.textContent = t(key);
			lbl.setAttribute('data-i18n', key);
		}
		updateStats();
	}

	// ========== COUNT-UP (redesign 2026) ==========
	// Anima un numero da 0 al valore finale su ~1.2s con ease-out cubico.
	// Rispetta prefers-reduced-motion (imposta subito il valore finale).
	// `decimals`: cifre decimali; `suffix`: testo dopo il numero (es. "g").
	function animateCount(el, to, decimals = 0, suffix = '') {
		if (!el) return;
		to = Number(to) || 0;
		const fmt = v => fmtNum(v, decimals) + suffix;
		const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		// A documento non visibile (PWA avviata in background, tab non a fuoco) i callback
		// di requestAnimationFrame non partono: l'animazione resterebbe congelata e il
		// contatore fermo al placeholder finché non si torna in foreground. Scrivi subito.
		if (reduce || document.visibilityState !== 'visible') { el.textContent = fmt(to); return; }
		const dur = 1100;
		const t0 = performance.now();
		const step = now => {
			const p = Math.min(1, (now - t0) / dur);
			const e = 1 - Math.pow(1 - p, 3);
			el.textContent = fmt(to * e);
			if (p < 1) requestAnimationFrame(step);
			else el.textContent = fmt(to);
		};
		requestAnimationFrame(step);
	}

	document.addEventListener('i18n:change', () => {
		const p = getCurrentPageName();
		if (p && p !== 'auth') refreshPageDynamicContent(p);
		if (document.getElementById('tutorialModal')?.style.display === 'flex') renderTutorialStep();
	});

	// ========== CARICAMENTO LAZY: Leaflet/MarkerCluster e Chart.js ==========
	// Non sono in index.html: pesano ~174 KiB e servono solo nelle pagine Mappa/Grafici.
	// Le funzioni sotto li iniettano a runtime la prima volta che servono davvero, e
	// mantengono in cache la stessa Promise così le chiamate successive sono no-op.
	function loadScriptOnce(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = () => reject(new Error('Impossibile caricare ' + src));
			document.head.appendChild(s);
		});
	}

	function loadStyleOnce(href) {
		return new Promise((resolve, reject) => {
			const l = document.createElement('link');
			l.rel = 'stylesheet';
			l.href = href;
			l.onload = resolve;
			l.onerror = () => reject(new Error('Impossibile caricare ' + href));
			document.head.appendChild(l);
		});
	}

	let _mapLibsPromise = null;
	function loadMapLibs() {
		if (_mapLibsPromise) return _mapLibsPromise;
		_mapLibsPromise = Promise.all([
			loadStyleOnce('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'),
			loadStyleOnce('https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css'),
			loadStyleOnce('https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css')
		])
			.then(() => loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'))
			.then(() => loadScriptOnce('https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js'));
		return _mapLibsPromise;
	}

	let _chartJsPromise = null;
	function loadChartJs() {
		if (typeof Chart !== 'undefined') return Promise.resolve();
		if (_chartJsPromise) return _chartJsPromise;
		_chartJsPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js');
		return _chartJsPromise;
	}

	// ========== MAPPA (CORRETTA DAL PRIMO CODICE) ==========
	let markerClusterGroup = null; // Aggiungi questa variabile globale all'inizio

// Salto rapido a un indirizzo sulla mappa principale (barra di ricerca
// flottante, redesign 2026 handoff 2k). Non tocca il flusso "aggiungi posto".
async function mapAddressJump() {
    const input = document.getElementById('mapJumpInput');
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
        const data = await res.json();
        if (!data || data.length === 0) return alert(t('places.addressNotFound'));
        if (mapInstance) mapInstance.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 15);
    } catch (e) {
        alert(t('places.searchError'));
    }
}

function initMap() {
    if (mapInstance) mapInstance.remove();
    mapInstance = L.map('mapContainer', { zoomControl: false }).setView([45.46, 9.19], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapInstance);

    // Inizializziamo il gruppo di cluster
    markerClusterGroup = L.markerClusterGroup();
    mapInstance.addLayer(markerClusterGroup);
}

function updateMap() {
    if (!mapInstance) initMap();
    
    markerClusterGroup.clearLayers();
    
    const filter = document.querySelector('input[name="mapFilter"]:checked').value;
    let filteredSmokes = smokes;
    
    if (filter === 'fumo') filteredSmokes = smokes.filter(s => personalSplit(s).fumo > 0);
    else if (filter === 'erba') filteredSmokes = smokes.filter(s => personalSplit(s).erba > 0);

    const savedPlaceNames = userPlaces.map(p => p.name);
    
    const grouped = {};
    const singles = [];

    filteredSmokes.forEach(s => {
        if (!s.latitude || !s.longitude) return;

        if (s.location_name && savedPlaceNames.includes(s.location_name)) {
            if (!grouped[s.location_name]) {
                grouped[s.location_name] = {
                    name: s.location_name,
                    lat: s.latitude,
                    lng: s.longitude,
                    count: 0,
                    grams: 0
                };
            }
            grouped[s.location_name].count++;
            grouped[s.location_name].grams += personalGrams(s);
        } else {
            singles.push(s);
        }
    });

    let totalCount = 0;
    let totalGrams = 0;
    let bounds = L.latLngBounds();

    // Marker raggruppati per posti salvati (etichetta verde)
    Object.values(grouped).forEach(place => {
        const markerEl = L.divIcon({
            html: `<div style="background: #2e7d32; min-width: 50px; padding: 6px 10px; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 2px solid white; text-align: center; white-space: nowrap;">
                🌿 ${escapeHtml(place.name)}<br>
                <span style="font-size: 11px; font-weight: normal;">${place.count}x · ${fmtNum(place.grams, 1)}g</span>
            </div>`,
            iconSize: null,
            iconAnchor: [25, 20]
        });

        const marker = L.marker([place.lat, place.lng], { icon: markerEl })
            .bindPopup(`<strong>📍 ${escapeHtml(place.name)}</strong><br>${t('places.sessionsPopup', { count: place.count })}<br>${t('places.totalPopup', { grams: fmtNum(place.grams, 1) })}`);

        markerClusterGroup.addLayer(marker);
        bounds.extend([place.lat, place.lng]);
        totalCount += place.count;
        totalGrams += place.grams;
    });

    // Marker singoli normali (cerchio colorato con emoji)
    singles.forEach(s => {
        let color, icon;
        if (s.type === 'fumo-erba') { color = '#66BB6A'; icon = '🍫🍃'; }
        else if (s.type === 'erba') { color = '#4CAF50'; icon = '🍃'; }
        else { color = '#8B4513'; icon = '🍫'; }

        const markerEl = L.divIcon({
            html: `<div style="background: ${color}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 3px solid white;">${icon}</div>`,
            iconSize: [40, 40]
        });

        const marker = L.marker([s.latitude, s.longitude], { icon: markerEl })
            .bindPopup(`<strong>${escapeHtml(s.location_name || t('places.locationFallback'))}</strong><br>${formatShortDate(s.date)} ${escapeHtml(s.time)}<br>${fmtNum(personalGrams(s), 2, 0)}g`);

        markerClusterGroup.addLayer(marker);
        bounds.extend([s.latitude, s.longitude]);
        totalCount++;
        totalGrams += personalGrams(s);
    });

    if (totalCount > 0) {
        mapInstance.fitBounds(bounds, { padding: [50, 50] });
    }

    document.getElementById('mapStats').innerHTML = `
        <div class="stat-box"><big>${totalCount}</big><small>${t('places.statSessions')}</small></div>
        <div class="stat-box"><big>${fmtNum(totalGrams, 1)}g</big><small>${t('places.statTotal')}</small></div>
    `;
}

	// ========== AGGIORNAMENTO GENERALE ==========
	// opts.deferHeavy: true solo dal primo caricamento dati (vedi loadData()). Il rendering
	// visibile subito in Home parte comunque sincrono; il resto (registro, grafici, insight...)
	// non è ancora visibile a quel punto e viene rimandato a dopo il first paint con
	// requestIdleCallback, così non allunga il tempo prima che l'utente veda qualcosa.
	function update(opts) {
		opts = opts || {};

		checkReminderBanner();
		renderHomeSummary();
		renderMiniWidget();

		const renderRest = () => {
			updateHistory();
			updateStats();
			renderCharts();
			renderPeriodComparison();
			renderInsights();
			renderContextStats();
			renderGoalCard();
			renderBreakCard();
			renderStockPage();
			if (achievementsLoaded) checkAchievements();
		};

		if (opts.deferHeavy && 'requestIdleCallback' in window) {
			requestIdleCallback(renderRest, { timeout: 1500 });
		} else {
			renderRest();
		}
	}

	// ========== HOME: riepilogo ==========
	function renderHomeSummary() {
		const greetingEl = document.getElementById('homeGreeting');
		if (!greetingEl) return;

		document.getElementById('homeHeroCard')?.classList.remove('is-loading');

		const hour = new Date().getHours();
		const greeting = hour < 6 ? t('home.greetingNight') : hour < 12 ? t('home.greetingMorning') : hour < 18 ? t('home.greetingAfternoon') : t('home.greetingEvening');
		greetingEl.textContent = greeting;

		const streakVal = calculateStreak();
		// Anima i contatori solo quando i dati sono davvero caricati. Al boot showApp()
		// disegna la Home mentre smokes è ancora [] (loadData() gira in parallelo): senza
		// questo gate il primo render lancerebbe un count-up verso 0 che, ancora in corso
		// quando i dati arrivano ~300ms dopo, riscrive 0 sopra i valori reali — e la Home
		// resta a zero finché non si cambia pagina e si torna. Il flag viene consumato solo
		// quando animiamo davvero, così il render post-caricamento fa comunque il count-up.
		const animateHome = homeAnimateOnce && smokesLoaded;
		if (animateHome) homeAnimateOnce = false;
		if (animateHome) {
			animateCount(document.getElementById('homeStreak'), streakVal, 0);
		} else {
			document.getElementById('homeStreak').textContent = streakVal;
		}

		// Sotto-riga: "record N giorni" se il miglior streak storico supera quello attuale
		const bestEl = document.getElementById('homeStreakBest');
		if (bestEl) {
			const best = longestStreak();
			bestEl.textContent = best > streakVal ? ' · ' + t('home.streakBest', { days: best }) : '';
		}

		const now = new Date();
		const currentMonthKey = getMonthKey(now);
		const monthSmokes = smokes.filter(s => getMonthKey(s.date) === currentMonthKey);
		const monthGrams = monthSmokes.reduce((sum, s) => sum + personalGrams(s), 0);
		document.getElementById('homeMonthStat').textContent = tn('home.monthStat', monthSmokes.length, { grams: fmtNum(monthGrams, 1) });

		// ---- Tessere hero: oggi / ultimi 7 giorni / vs stesso periodo del mese scorso ----
		const today = toDateStr(now);
		const todayCount = smokes.filter(s => s.date === today).length;
		const weekStart = shiftDateStr(today, -6);
		const weekGrams = smokes
			.filter(s => s.date >= weekStart && s.date <= today)
			.reduce((sum, s) => sum + personalGrams(s), 0);

		const mtd = monthToDateComparison();

		const todayEl = document.getElementById('homeTodayCount');
		const weekEl = document.getElementById('homeWeekGrams');
		const vsEl = document.getElementById('homeVsLast');
		if (animateHome) {
			animateCount(todayEl, todayCount, 0);
			animateCount(weekEl, weekGrams, 1, ' g');
		} else {
			if (todayEl) todayEl.textContent = todayCount;
			if (weekEl) weekEl.textContent = fmtNum(weekGrams, 1) + ' g';
		}
		if (vsEl) {
			// La freccia è resa via CSS ::before su .is-up/.is-down/.is-flat,
			// così il testo del valore resta breve e non va mai a capo.
			vsEl.classList.remove('is-up', 'is-down', 'is-flat');
			if (mtd.prev.length === 0) {
				vsEl.textContent = mtd.cur.length > 0 ? t('home.deltaNew') : '–';
			} else {
				const pct = ((mtd.cur.length - mtd.prev.length) / mtd.prev.length) * 100;
				const up = pct > 0.5, down = pct < -0.5;
				vsEl.textContent = fmtNum(Math.abs(pct), 0) + '%';
				vsEl.classList.add(up ? 'is-up' : down ? 'is-down' : 'is-flat');
			}
		}

		const reminderLine = document.getElementById('homeReminderLine');
		if (userReminderSettings && userReminderSettings.reminder_enabled && userReminderSettings.reminder_time) {
			reminderLine.textContent = t('home.reminderAt', { time: userReminderSettings.reminder_time.slice(0, 5) });
			reminderLine.style.display = 'inline';
		} else {
			reminderLine.style.display = 'none';
		}

		const teaserEl = document.getElementById('homeAchievementTeaser');
		if (unlockedAchievements.length > 0) {
			const lastKey = unlockedAchievements[unlockedAchievements.length - 1];
			const lastAch = ACHIEVEMENTS.find(a => a.key === lastKey);
			if (lastAch) {
				teaserEl.textContent = t('home.lastAchievement', { icon: lastAch.icon, title: achTitle(lastAch.key) });
				teaserEl.style.display = 'block';
			}
		} else {
			teaserEl.style.display = 'none';
		}
	}

// ========== HOME: stato pausa attiva ==========
// Unico punto che decide se mostrare la card home dedicata alla pausa (spec §8): legge
// activeBreak, la stessa variabile mantenuta da loadBreaks()/runBreakDetection() per
// rilevamento, notifiche e card statistiche — nessuna logica duplicata.
const BREAK_MILESTONES = [2, 7, 14, 28];

// Giorni PIENI di pausa trascorsi (0 il giorno di inizio), su date di calendario: il vecchio
// floor((adesso - mezzanotte UTC di start_date)/24h) segnava un giorno in meno fra 00:00 e 02:00.
function breakDaysElapsed(brk) {
	return Math.max(0, daysBetween(brk.start_date, todayStr()));
}

// Durata di una pausa conclusa: giorni da start_date (incluso) a end_date (escluso).
function breakDurationDays(brk) {
	return Math.max(0, daysBetween(brk.start_date, brk.end_date));
}

function renderHomeBreakState() {
	const normalCard = document.getElementById('homeHeroCard');
	const breakCardEl = document.getElementById('homeBreakHero');
	if (!normalCard || !breakCardEl) return;

	if (!activeBreak) {
		breakCardEl.style.display = 'none';
		normalCard.style.display = '';
		return;
	}

	normalCard.style.display = 'none';
	breakCardEl.style.display = '';

	const days = breakDaysElapsed(activeBreak);

	document.getElementById('homeBreakDays').textContent = days;

	const nextMilestone = BREAK_MILESTONES.find(m => m > days);
	const prevMilestone = [...BREAK_MILESTONES].reverse().find(m => m <= days);

	const progressLabel = document.getElementById('homeBreakProgressLabel');
	const progressBar = document.getElementById('homeBreakProgressBar');
	const ring = document.getElementById('homeBreakRing');
	let pct;
	if (nextMilestone) {
		const prevAnchor = prevMilestone || 0;
		pct = Math.min(100, Math.round(((days - prevAnchor) / (nextMilestone - prevAnchor)) * 100));
		progressBar.style.width = pct + '%';
		progressLabel.textContent = tn('breaks.homeNextMilestone', nextMilestone - days, { days: nextMilestone - days, milestone: nextMilestone });
	} else {
		pct = 100;
		progressBar.style.width = '100%';
		progressLabel.textContent = t('breaks.homeMilestonesComplete');
	}
	// anello: pathLength=100, offset 100→0 = 0%→100%
	if (ring) requestAnimationFrame(() => { ring.style.strokeDashoffset = String(100 - pct); });

	document.getElementById('homeBreakMicroText').textContent = prevMilestone ? t(`breaks.milestone${prevMilestone}Short`) : t('breaks.homeJustStarted');

	const recordEl = document.getElementById('homeBreakRecord');
	const pastDurations = allBreaks
		.filter(b => b.id !== activeBreak.id && !b.attempted && b.end_date)
		.map(breakDurationDays);
	const record = pastDurations.length ? Math.max(...pastDurations) : null;

	if (record !== null) {
		recordEl.style.display = 'block';
		// Per SUPERARE un record di N giorni ne servono N+1: con N giorni fatti mancava
		// "0 giorni" (audit F-12).
		const toBeat = record - days + 1;
		recordEl.textContent = days > record
			? t('breaks.homeNewRecord', { days: record })
			: tn('breaks.homeRecordGap', toBeat, { days: toBeat });
	} else {
		recordEl.style.display = 'none';
	}
}

// ========== TOLERANCE BREAK: notifiche milestone scientifici + check-in (spec §7/§9) ==========
// Testi basati su Hirvonen et al. 2012 (Molecular Psychiatry) e D'Souza et al. 2016
// (Biological Psychiatry: CNNI) sul recupero dei recettori CB1 — nota informativa di
// popolazione, non un consiglio medico personalizzato: disclaimer sempre incluso nel
// messaggio dei milestone scientifici. Il check-in generico usa un copy diverso, in
// rotazione, e non compare mai lo stesso giorno di un milestone (priorità al messaggio
// scientifico). Le notifiche passano dalla RPC insert_own_notification (SECURITY DEFINER,
// vedi CLAUDE.md) perché la RLS di "notifications" non concede INSERT diretto agli utenti.
const BREAK_CHECKIN_KEYS = ['breaks.checkin1', 'breaks.checkin2', 'breaks.checkin3'];

// Guard contro esecuzioni concorrenti (loadBreaks() puo' partire da showApp e da un salvataggio
// quasi insieme): due giri paralleli leggevano lo stesso notified_milestones e duplicavano le
// notifiche. In piu' la RPC salva chiave + parametri (con break_id) e il DB ha un indice unico
// su quella combinazione, quindi la stessa milestone della stessa pausa non puo' ripetersi.
let breakNotificationsRunning = false;

async function checkBreakNotifications(brk) {
	if (!brk || breakNotificationsRunning) return;
	breakNotificationsRunning = true;
	try {
		const days = breakDaysElapsed(brk);
		const notified = brk.notified_milestones || [];
		// Tutti i milestone raggiunti e non ancora notificati, non solo il primo: se l'utente
		// non apre l'app per un po' e "salta" piu' traguardi, li recupera tutti in un colpo solo
		// invece di riceverli uno per volta nei prossimi accessi.
		const dueMilestones = BREAK_MILESTONES.filter(m => days >= m && !notified.includes(m));

		if (dueMilestones.length > 0) {
			for (const milestone of dueMilestones) {
				const ok = await insertBreakNotification(
					t(`breaks.milestone${milestone}`) + ' ' + t('breaks.milestoneDisclaimer'),
					'tolerance_break_milestone',
					`breaks.milestone${milestone}`,
					{ break_id: brk.id, milestone, disclaimer: true }
				);
				if (!ok) return; // riprova al prossimo accesso, senza segnare il milestone come notificato
			}
			const updatedNotified = [...notified, ...dueMilestones];
			const { error } = await supabaseClient.from('tolerance_breaks')
				.update({ notified_milestones: updatedNotified })
				.eq('id', brk.id);
			if (!error) brk.notified_milestones = updatedNotified;
			return; // priorita' ai messaggi scientifici: niente check-in lo stesso giorno
		}

		if (days > 0 && days % 3 === 0 && !BREAK_MILESTONES.includes(days) && brk.last_checkin_notified_day !== days) {
			const variant = (days / 3) % BREAK_CHECKIN_KEYS.length;
			const key = BREAK_CHECKIN_KEYS[variant];
			const ok = await insertBreakNotification(t(key, { days }), 'tolerance_break_milestone', key, { break_id: brk.id, days });
			if (!ok) return;
			const { error } = await supabaseClient.from('tolerance_breaks')
				.update({ last_checkin_notified_day: days })
				.eq('id', brk.id);
			if (!error) brk.last_checkin_notified_day = days;
		}
	} finally {
		breakNotificationsRunning = false;
	}
}

// message: testo gia' tradotto (fallback per client vecchi); key/params: la notifica viene
// ritradotta al render nella lingua attiva (notifText) invece di restare in quella di oggi.
async function insertBreakNotification(message, type, key, params) {
	const { error } = await supabaseClient.rpc('insert_own_notification', {
		p_type: type, p_message: message, p_key: key, p_params: params || {}
	});
	if (error) console.error('insert_own_notification:', error);
	return !error;
}

// ========== TOLERANCE BREAK: suggerimento proattivo di pausa ==========
// A differenza del rilevamento (spec §1, reagisce a un gap già avvenuto), questo osserva
// il consumo CORRENTE: se resta sostenuto a livello moderato/pesante (stessa classificazione
// di classifyPreBreakLevel/getPeriodAverage, nessuna duplicazione) per BREAK_SUGGESTION_MIN_DAYS
// giorni consecutivi, manda un unico avviso in-app gentile (mai push, per restare leggero) e
// lo ripete al massimo ogni BREAK_SUGGESTION_REPEAT_DAYS giorni se l'utente non agisce. Lo stato
// "elevated_since"/"last_break_suggestion_at" vive su user_stats (un solo avviso alla volta,
// niente notifiche se una pausa è già attiva o pianificata — vedi il chiamante in loadBreaks()).
const BREAK_SUGGESTION_MIN_DAYS = 14;
const BREAK_SUGGESTION_REPEAT_DAYS = 21;

async function checkBreakSuggestion() {
	const today = toDateStr(new Date());
	const windowStart = shiftDateStr(today, -29);
	const level = classifyPreBreakLevel(getPeriodAverage(windowStart, today).jointsPerDay);

	const { data: stats } = await supabaseClient
		.from('user_stats')
		.select('elevated_since, last_break_suggestion_at')
		.eq('user_id', currentUser.id)
		.maybeSingle();

	if (level === 'light') {
		if (stats && stats.elevated_since) {
			await supabaseClient.from('user_stats')
				.upsert({ user_id: currentUser.id, elevated_since: null }, { onConflict: 'user_id' });
		}
		return;
	}

	if (!stats || !stats.elevated_since) {
		await supabaseClient.from('user_stats')
			.upsert({ user_id: currentUser.id, elevated_since: today }, { onConflict: 'user_id' });
		return; // primo giorno rilevato sopra soglia: aspettiamo che diventi "sostenuto"
	}

	const daysSustained = daysBetween(stats.elevated_since, today);
	if (daysSustained < BREAK_SUGGESTION_MIN_DAYS) return;

	const daysSinceLastSuggestion = stats.last_break_suggestion_at
		? Math.floor((new Date() - new Date(stats.last_break_suggestion_at)) / (1000 * 60 * 60 * 24))
		: Infinity;
	if (daysSinceLastSuggestion < BREAK_SUGGESTION_REPEAT_DAYS) return;

	const key = level === 'heavy' ? 'breaks.suggestionHeavy' : 'breaks.suggestionModerate';
	if (!(await insertBreakNotification(t(key), 'break_suggestion', key, {}))) return;
	await supabaseClient.from('user_stats')
		.upsert({ user_id: currentUser.id, last_break_suggestion_at: new Date().toISOString() }, { onConflict: 'user_id' });
}

// ========== TUTORIAL PRIMO ACCESSO ==========
// title/text sono chiavi di traduzione, non testo diretto, così il tutorial resta
// coerente se l'utente cambia lingua mentre è aperto (vedi listener i18n:change).
const TUTORIAL_SLIDES = [
	{ icon: '🌿', titleKey: 'tutorial.slide1Title', textKey: 'tutorial.slide1Text' },
	{ icon: '➕', titleKey: 'tutorial.slide2Title', textKey: 'tutorial.slide2Text' },
	{ icon: '📦', titleKey: 'tutorial.slide3Title', textKey: 'tutorial.slide3Text' },
	{ icon: '📊', titleKey: 'tutorial.slide4Title', textKey: 'tutorial.slide4Text' },
	{ icon: '🎯', titleKey: 'tutorial.slide5Title', textKey: 'tutorial.slide5Text' },
	{ icon: '👥', titleKey: 'tutorial.slide6Title', textKey: 'tutorial.slide6Text' },
	{ icon: '⚙️', titleKey: 'tutorial.slide7Title', textKey: 'tutorial.slide7Text' }
];

let tutorialStep = 0;

function renderTutorialStep() {
	const slide = TUTORIAL_SLIDES[tutorialStep];
	document.getElementById('tutorialSlide').innerHTML = `
		<div style="text-align:center; padding:10px 0;">
			<div style="font-size:48px; margin-bottom:15px;">${slide.icon}</div>
			<h3 style="margin-bottom:10px;">${t(slide.titleKey)}</h3>
			<p style="color:var(--color-text-secondary); font-size:14px; line-height:1.6;">${t(slide.textKey)}</p>
		</div>
	`;

	document.getElementById('tutorialDots').innerHTML = TUTORIAL_SLIDES.map((_, i) =>
		`<span style="width:7px; height:7px; border-radius:50%; background:${i === tutorialStep ? 'var(--primary-light)' : 'rgba(var(--overlay-rgb),0.2)'};"></span>`
	).join('');

	document.getElementById('tutorialPrevBtn').style.display = tutorialStep === 0 ? 'none' : 'block';
	document.getElementById('tutorialSkipBtn').style.display = tutorialStep === TUTORIAL_SLIDES.length - 1 ? 'none' : 'block';
	document.getElementById('tutorialNextBtn').textContent = tutorialStep === TUTORIAL_SLIDES.length - 1 ? t('tutorial.start') : t('modals.tutorialNext');
}

function openTutorial() {
	tutorialStep = 0;
	renderTutorialStep();
	document.getElementById('tutorialModal').style.display = 'flex';
}

function tutorialNext() {
	if (tutorialStep < TUTORIAL_SLIDES.length - 1) {
		tutorialStep++;
		renderTutorialStep();
	} else {
		finishTutorial();
	}
}

function tutorialPrev() {
	if (tutorialStep > 0) {
		tutorialStep--;
		renderTutorialStep();
	}
}

function skipTutorial() {
	finishTutorial();
}

async function finishTutorial() {
	document.getElementById('tutorialModal').style.display = 'none';
	await supabaseClient.from('profiles').update({ onboarding_completed: true }).eq('id', currentUser.id);
}

async function checkOnboarding() {
	const { data } = await supabaseClient.from('profiles').select('onboarding_completed').eq('id', currentUser.id).single();
	if (data && data.onboarding_completed === false) {
		openTutorial();
	}
}

// ========== AVATAR ==========
// profiles.avatar_url può essere: una URL http(s) (foto caricata), un sentinel
// "preset:<key>", oppure null. avatarMarkup() è l'UNICO punto che interpreta il
// campo — ogni superficie che mostra un utente passa di qui. Vedi
// docs/superpowers/specs/2026-08-30-avatar-utente-design.md §3.

const PRESET_AVATARS = {
	leaf: '🍃', herb: '🌿', sprout: '🌱', evergreen: '🌲',
	sun: '☀️', moon: '🌙', fire: '🔥', sparkle: '✨',
};
const PRESET_KEYS = Object.keys(PRESET_AVATARS);

// Solo un file sotto questo prefisso (bucket pubblico "avatars") è reso come <img>.
// Qualsiasi altra URL in avatar_url degrada all'iniziale — impedisce che un valore
// manomesso (RLS permette a un utente di scrivere stringhe arbitrarie sulla propria
// riga profiles) diventi un <img src> remoto nella leaderboard di tutti gli altri.
// Vincolato anche lato DB dal CHECK profiles_avatar_url_shape.
const AVATAR_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/avatars/`;

function presetEmoji(key) {
	return Object.prototype.hasOwnProperty.call(PRESET_AVATARS, key) ? PRESET_AVATARS[key] : null;
}

// Hash deterministico (djb2) -> tinta stabile per l'iniziale di fallback.
// S/L fissi scelti per reggere sia tema chiaro che scuro con testo bianco.
function hslFromHash(str) {
	let h = 5381;
	const s = String(str || '?');
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return `hsl(${Math.abs(h) % 360} 45% 45%)`;
}

// Ritorna markup HTML per un avatar. `username` serve solo per l'iniziale e l'alt.
function avatarMarkup(avatarUrl, username, sizePx = 32) {
	const name = String(username || '?');
	const initial = escapeHtml(name.trim().slice(0, 1).toUpperCase() || '?');
	const px = Math.round(sizePx);
	const fontPx = Math.round(px * 0.44);
	const dims = `width:${px}px;height:${px}px;`;

	if (typeof avatarUrl === 'string' && avatarUrl.startsWith('preset:')) {
		const emoji = presetEmoji(avatarUrl.slice(7));
		if (emoji) {
			return `<span class="avatar avatar-preset" style="${dims}font-size:${Math.round(px * 0.55)}px;" aria-hidden="true">${emoji}</span>`;
		}
		// key ignota -> degrada a iniziale
	} else if (typeof avatarUrl === 'string' && avatarUrl.startsWith(AVATAR_URL_PREFIX)) {
		return `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="" `
			+ `width="${px}" height="${px}" loading="lazy" referrerpolicy="no-referrer" `
			+ `data-initial="${initial}" data-hue="${escapeHtml(hslFromHash(name))}" `
			+ `onerror="avatarImgFallback(this)">`;
	}

	return `<span class="avatar avatar-fallback" style="${dims}font-size:${fontPx}px;background:${hslFromHash(name)};">${initial}</span>`;
}

// Sostituisce un <img> avatar rotto (file 404) con l'iniziale colorata,
// senza rifare query (initial/hue sono nei data-attr). Stesso pattern di fallbackPlainPhoto.
function avatarImgFallback(img) {
	if (img.dataset.fallbackDone) return;
	img.dataset.fallbackDone = '1';
	const span = document.createElement('span');
	span.className = 'avatar avatar-fallback';
	span.style.cssText = `width:${img.width}px;height:${img.height}px;font-size:${Math.round(img.width * 0.44)}px;background:${img.dataset.hue || 'hsl(140 45% 45%)'};`;
	span.textContent = img.dataset.initial || '?';
	img.replaceWith(span);
}

// --- stato/preferenza avatar guest (solo preset) ---
const GUEST_AVATAR_KEY = 'jt_guest_avatar';
function getGuestAvatar() {
	try {
		const v = localStorage.getItem(GUEST_AVATAR_KEY);
		return v && v.startsWith('preset:') ? v : null;
	} catch (e) { return null; }
}
function setGuestAvatar(val) { try { localStorage.setItem(GUEST_AVATAR_KEY, val); } catch (e) {} }
function clearGuestAvatar() { try { localStorage.removeItem(GUEST_AVATAR_KEY); } catch (e) {} }

// Migra il preset avatar da localStorage al profilo dell'utente. Chiamata
// a ogni ingresso in un account (login/signup), indipendentemente dal fatto
// che ci fossero smokes/purchases guest da migrare.
async function migrateGuestAvatar(userId) {
	const val = getGuestAvatar();
	if (!val) return;
	try {
		const { error } = await supabaseClient.from('profiles').upsert({ id: userId, avatar_url: val });
		if (error) throw error;
		// logout -> preset da guest -> login: un file avatar caricato in una
		// sessione precedente resterebbe orfano ora che avatar_url è un preset.
		// currentUser è impostato qui, quindi il guard di removeUploadedAvatarFiles passa.
		await removeUploadedAvatarFiles();
		clearGuestAvatar();
		if (currentUserProfile) currentUserProfile.avatar_url = val;
	} catch (e) {
		console.error('migrateGuestAvatar:', e); // i dati guest restano, si riprova al prossimo login
	}
}

function currentAvatarValue() {
	return isGuestMode ? getGuestAvatar() : (currentUserProfile && currentUserProfile.avatar_url) || null;
}

let avatarMode = 'upload'; // 'upload' | 'preset'
// True appena l'utente tocca una tab avatar in Impostazioni: blocca l'auto-switch
// a "Scegli icona" di renderAvatarSettings (vedi lì). I due bottoni tab sono gli
// unici chiamanti di setAvatarMode, quindi ogni chiamata è una scelta manuale.
let avatarModeUserPicked = false;
function setAvatarMode(mode) {
	avatarModeUserPicked = true;
	avatarMode = mode;
	document.getElementById('avatarModeUpload').classList.toggle('active', mode === 'upload');
	document.getElementById('avatarModePreset').classList.toggle('active', mode === 'preset');
	document.getElementById('avatarUploadPane').style.display = mode === 'upload' ? '' : 'none';
	document.getElementById('avatarPresetPane').style.display = mode === 'preset' ? '' : 'none';
	clearAvatarError();
}

function clearAvatarError() {
	const el = document.getElementById('avatarError');
	if (el) { el.style.display = 'none'; el.textContent = ''; }
}
function showAvatarError(msg) {
	const el = document.getElementById('avatarError');
	if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function renderAvatarSettings() {
	const preview = document.getElementById('avatarPreview');
	if (!preview) return;
	const val = currentAvatarValue();

	// Se l'avatar corrente è un preset, mostra il pannello "Scegli icona" così il
	// preset attivo è visibile — ma solo finché l'utente non ha scelto una tab a mano.
	if (!avatarModeUserPicked && typeof val === 'string' && val.startsWith('preset:') && avatarMode !== 'preset') {
		setAvatarMode('preset');
	}

	const name = (currentUserProfile && currentUserProfile.username) || (currentUser && currentUser.email) || '?';
	preview.innerHTML = avatarMarkup(val, name, 72);

	document.getElementById('avatarRemoveBtn').style.display = val ? '' : 'none';

	// guest: niente upload
	const guest = isGuestMode;
	document.getElementById('avatarGuestHint').style.display = guest ? 'block' : 'none';
	document.getElementById('avatarChooseBtn').style.display = guest ? 'none' : '';

	// griglia preset
	const grid = document.getElementById('avatarPresetGrid');
	grid.innerHTML = PRESET_KEYS.map(key => {
		const selected = val === `preset:${key}`;
		return `<button type="button" class="avatar-preset-cell${selected ? ' is-selected' : ''}" `
			+ `data-preset-key="${key}" onclick="selectPresetAvatar('${key}')" aria-pressed="${selected}">`
			+ `${PRESET_AVATARS[key]}</button>`;
	}).join('');
}

async function selectPresetAvatar(key) {
	if (!PRESET_KEYS.includes(key)) return;
	clearAvatarError();
	const value = `preset:${key}`;

	if (isGuestMode) {
		setGuestAvatar(value);
		renderAvatarSettings();
		return;
	}

	try {
		// upsert PRIMA: se fallisce, il file avatar esistente resta intatto (spec §10).
		const { error } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, avatar_url: value });
		if (error) throw error;
		await removeUploadedAvatarFiles(); // solo dopo il successo: non lasciare orfana la vecchia foto
		currentUserProfile = { ...(currentUserProfile || {}), avatar_url: value };
		renderAvatarSettings();
		refreshMountedAvatars();
		showMessage(t('settings.avatarUpdated'));
	} catch (e) {
		console.error('selectPresetAvatar:', e);
		showAvatarError(t('settings.avatarUploadError'));
	}
}

async function removeAvatar() {
	clearAvatarError();
	if (isGuestMode) {
		clearGuestAvatar();
		renderAvatarSettings();
		return;
	}
	try {
		// upsert PRIMA: se fallisce, il file avatar esistente resta intatto (spec §10).
		const { error } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, avatar_url: null });
		if (error) throw error;
		await removeUploadedAvatarFiles(); // solo dopo il successo
		currentUserProfile = { ...(currentUserProfile || {}), avatar_url: null };
		renderAvatarSettings();
		refreshMountedAvatars();
		showMessage(t('settings.avatarRemoved'));
	} catch (e) {
		console.error('removeAvatar:', e);
		showAvatarError(t('settings.avatarUploadError'));
	}
}

// Ridisegna le superfici avatar attualmente montate nel DOM dopo un cambio.
// Le pagine non montate si aggiornano al loro prossimo load.
function refreshMountedAvatars() {
	// Solo la leaderboard, e solo se è la pagina attiva (spec §5.3: le altre
	// superfici si aggiornano al prossimo caricamento). loadFeed() NON va chiamato
	// qui: resetta comments/commentsOpen (chiude i thread aperti) e fa un
	// get_snapshot_feed + createSignedUrls per ogni click preset.
	if (document.getElementById('page-social')?.classList.contains('active')) {
		if (typeof loadSocial === 'function') loadSocial();
	}
}

// --- crop interattivo (pan + zoom), vanilla ---
const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_OUT_SIZE = 256;

let avatarCrop = null;

function handleAvatarFileSelected(event) {
	const input = event.target;
	const file = input.files && input.files[0];
	if (!file) return;
	clearAvatarError();

	if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
		showAvatarError(t('settings.avatarFormatError'));
		input.value = '';
		return;
	}
	if (file.size > AVATAR_MAX_BYTES) {
		showAvatarError(t('settings.avatarTooLarge'));
		input.value = '';
		return;
	}

	const url = URL.createObjectURL(file);
	const img = new Image();
	img.onload = () => { openAvatarCrop(img, url); };
	img.onerror = () => {
		URL.revokeObjectURL(url);
		showAvatarError(t('settings.avatarFormatError'));
		input.value = '';
	};
	img.src = url;
}

function openAvatarCrop(img, objectUrl) {
	// Un file precedente selezionato senza chiudere il modal lascerebbe orfano il suo objectUrl.
	if (avatarCrop && avatarCrop.objectUrl) URL.revokeObjectURL(avatarCrop.objectUrl);

	const viewport = document.getElementById('avatarCropViewport');
	const imgEl = document.getElementById('avatarCropImg');

	// Mostrare il modal PRIMA di misurare: da display:none il viewport ha
	// clientWidth 0 -> minScale 0 -> transform NaN.
	document.getElementById('avatarCropError').style.display = 'none';
	document.getElementById('avatarCropConfirmBtn').disabled = false;
	document.getElementById('avatarCropModal').style.display = 'flex';

	const V = viewport.clientWidth; // viewport quadrato: clientWidth === clientHeight (CSS)

	const natW = img.naturalWidth;
	const natH = img.naturalHeight;
	const minScale = V / Math.min(natW, natH);

	imgEl.src = objectUrl;
	imgEl.style.width = natW + 'px';
	imgEl.style.height = natH + 'px';

	avatarCrop = {
		objectUrl, natW, natH, V,
		minScale, scale: minScale,
		tx: (V - natW * minScale) / 2,
		ty: (V - natH * minScale) / 2,
		pointers: new Map(),
		pinchStartDist: 0, pinchStartScale: 0,
	};
	clampAvatarCrop();
	applyAvatarCropTransform();

	const zoom = document.getElementById('avatarCropZoom');
	zoom.min = '1'; zoom.max = '4'; zoom.value = '1';
}

function closeAvatarCrop() {
	if (avatarCrop && avatarCrop.objectUrl) URL.revokeObjectURL(avatarCrop.objectUrl);
	avatarCrop = null;
	document.getElementById('avatarCropModal').style.display = 'none';
	const input = document.getElementById('avatarFileInput');
	if (input) input.value = '';
}

// Vincola scale >= minScale e tx/ty in modo che l'immagine copra sempre il viewport.
function clampAvatarCrop() {
	const c = avatarCrop;
	if (c.scale < c.minScale) c.scale = c.minScale;
	const dispW = c.natW * c.scale;
	const dispH = c.natH * c.scale;
	c.tx = Math.min(0, Math.max(c.V - dispW, c.tx));
	c.ty = Math.min(0, Math.max(c.V - dispH, c.ty));
}

function applyAvatarCropTransform() {
	const c = avatarCrop;
	const imgEl = document.getElementById('avatarCropImg');
	imgEl.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${c.scale})`;
	// sync slider (scale relativo a minScale, range 1..4)
	const zoom = document.getElementById('avatarCropZoom');
	const rel = c.scale / c.minScale;
	if (Math.abs(parseFloat(zoom.value) - rel) > 0.01) zoom.value = String(Math.min(4, Math.max(1, rel)));
}

// Zoom mantenendo ancorato il punto immagine sotto (px, py) in coord viewport.
function zoomAvatarCropAround(newScale, px, py) {
	const c = avatarCrop;
	newScale = Math.min(c.minScale * 4, Math.max(c.minScale, newScale));
	const ix = (px - c.tx) / c.scale;
	const iy = (py - c.ty) / c.scale;
	c.scale = newScale;
	c.tx = px - ix * newScale;
	c.ty = py - iy * newScale;
	clampAvatarCrop();
	applyAvatarCropTransform();
}

function initAvatarCropInteractions() {
	const viewport = document.getElementById('avatarCropViewport');
	if (!viewport || viewport.dataset.wired) return;
	viewport.dataset.wired = '1';

	viewport.addEventListener('pointerdown', e => {
		if (!avatarCrop) return;
		viewport.setPointerCapture(e.pointerId);
		viewport.classList.add('is-grabbing');
		avatarCrop.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (avatarCrop.pointers.size === 2) {
			const pts = [...avatarCrop.pointers.values()];
			avatarCrop.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
			avatarCrop.pinchStartScale = avatarCrop.scale;
		}
	});

	viewport.addEventListener('pointermove', e => {
		if (!avatarCrop || !avatarCrop.pointers.has(e.pointerId)) return;
		const prev = avatarCrop.pointers.get(e.pointerId);
		const cur = { x: e.clientX, y: e.clientY };
		avatarCrop.pointers.set(e.pointerId, cur);

		if (avatarCrop.pointers.size === 1) {
			avatarCrop.tx += cur.x - prev.x;
			avatarCrop.ty += cur.y - prev.y;
			clampAvatarCrop();
			applyAvatarCropTransform();
		} else if (avatarCrop.pointers.size === 2) {
			const pts = [...avatarCrop.pointers.values()];
			const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
			if (avatarCrop.pinchStartDist > 0) {
				const rect = document.getElementById('avatarCropViewport').getBoundingClientRect();
				const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
				const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
				zoomAvatarCropAround(avatarCrop.pinchStartScale * (dist / avatarCrop.pinchStartDist), midX, midY);
			}
		}
	});

	const endPointer = e => {
		if (!avatarCrop) return;
		avatarCrop.pointers.delete(e.pointerId);
		if (avatarCrop.pointers.size < 2) avatarCrop.pinchStartDist = 0;
		if (avatarCrop.pointers.size === 0) viewport.classList.remove('is-grabbing');
	};
	viewport.addEventListener('pointerup', endPointer);
	viewport.addEventListener('pointercancel', endPointer);

	document.getElementById('avatarCropZoom').addEventListener('input', e => {
		if (!avatarCrop) return;
		const rel = parseFloat(e.target.value) || 1;
		const c = avatarCrop;
		zoomAvatarCropAround(c.minScale * rel, c.V / 2, c.V / 2);
	});
}
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initAvatarCropInteractions);
} else {
	initAvatarCropInteractions();
}

async function exportCroppedAvatar() {
	const c = avatarCrop;
	const img = document.getElementById('avatarCropImg');
	// regione visibile in coordinate immagine-naturali
	const sSize = c.V / c.scale;
	const sx = -c.tx / c.scale;
	const sy = -c.ty / c.scale;

	const canvas = document.createElement('canvas');
	canvas.width = AVATAR_OUT_SIZE;
	canvas.height = AVATAR_OUT_SIZE;
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, AVATAR_OUT_SIZE, AVATAR_OUT_SIZE);

	const toBlob = (type, q) => new Promise(res => canvas.toBlob(res, type, q));
	let blob = await toBlob('image/webp', 0.85);
	let ext = 'webp';
	if (!blob) { blob = await toBlob('image/jpeg', 0.85); ext = 'jpg'; }
	if (!blob) throw new Error('toBlob returned null');
	return { blob, ext };
}

async function confirmAvatarCrop() {
	const btn = document.getElementById('avatarCropConfirmBtn');
	const errEl = document.getElementById('avatarCropError');
	errEl.style.display = 'none';
	btn.disabled = true;
	setAvatarPreviewLoading(true);
	try {
		const out = await exportCroppedAvatar();
		await uploadAvatarBlob(out); // Task 6
		closeAvatarCrop();
		showMessage(t('settings.avatarUpdated'));
	} catch (e) {
		console.error('confirmAvatarCrop:', e);
		errEl.textContent = t('settings.avatarUploadError');
		errEl.style.display = 'block';
		btn.disabled = false;
	} finally {
		setAvatarPreviewLoading(false);
		renderAvatarSettings(); // ripristina preview (avatar corrente invariato in caso d'errore)
	}
}

function setAvatarPreviewLoading(on) {
	const preview = document.getElementById('avatarPreview');
	if (preview) preview.classList.toggle('avatar-loading', !!on);
}

// --- upload / cleanup Storage ---
const AVATARS_BUCKET = 'avatars';

async function removeUploadedAvatarFiles() {
	if (isGuestMode || !currentUser) return;
	try {
		await supabaseClient.storage.from(AVATARS_BUCKET).remove([
			`${currentUser.id}/avatar.webp`,
			`${currentUser.id}/avatar.jpg`,
		]);
	} catch (e) { /* best-effort: il file può non esistere */ }
}

async function uploadAvatarBlob({ blob, ext }) {
	if (isGuestMode || !currentUser) throw new Error('upload avatar non disponibile in guest');
	const path = `${currentUser.id}/avatar.${ext}`;
	const otherPath = `${currentUser.id}/avatar.${ext === 'webp' ? 'jpg' : 'webp'}`;
	const contentType = ext === 'webp' ? 'image/webp' : 'image/jpeg';

	// Ordine: upload -> upsert profiles -> pulizia dell'ALTRA estensione.
	// Qualsiasi errore prima della pulizia -> throw, niente cancellato: un
	// avatar funzionante resta intatto (spec §10). upsert:true sovrascrive
	// il file con lo stesso nome; non si tocca mai il nome appena scritto.
	const up = await supabaseClient.storage.from(AVATARS_BUCKET)
		.upload(path, blob, { upsert: true, contentType });
	if (up.error) throw up.error;

	const pub = supabaseClient.storage.from(AVATARS_BUCKET).getPublicUrl(path);
	const publicUrl = `${pub.data.publicUrl}?v=${Date.now()}`;

	const { error } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, avatar_url: publicUrl });
	if (error) throw error;

	// L'estensione può cambiare tra un upload e l'altro (webp<->jpg): rimuovi
	// solo il file dell'altra estensione, best-effort, dopo il successo.
	try {
		await supabaseClient.storage.from(AVATARS_BUCKET).remove([otherPath]);
	} catch (e) { /* best-effort: può non esistere */ }

	currentUserProfile = { ...(currentUserProfile || {}), avatar_url: publicUrl };
	renderAvatarSettings();
	refreshMountedAvatars();
}

// ========== FOTO SESSIONE ==========
let selectedPhotoFile = null;

// Ridimensiona lato client prima dell'upload (max 1600px sul lato lungo, JPEG q0.8):
// le foto da smartphone sono spesso 3-8MB, questo taglia drasticamente storage/banda
// senza differenza visibile nella galleria/viewer dell'app.
function compressImage(file, maxDim, quality) {
	return new Promise(resolve => {
		if (!file.type.startsWith('image/') || file.type === 'image/gif') {
			resolve(file); // GIF non tocca: la compressione via canvas perderebbe l'animazione
			return;
		}
		const img = new Image();
		const objectUrl = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(objectUrl);
			let { width, height } = img;
			const scale = Math.min(1, maxDim / Math.max(width, height));
			width = Math.round(width * scale);
			height = Math.round(height * scale);

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			canvas.getContext('2d').drawImage(img, 0, 0, width, height);

			canvas.toBlob(blob => {
				if (!blob) { resolve(file); return; }
				resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
			}, 'image/jpeg', quality);
		};
		img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); }; // es. HEIC non decodificabile dal browser: carica l'originale
		img.src = objectUrl;
	});
}

async function handlePhotoSelected(event) {
	const file = event.target.files[0];
	if (!file) return;

	if (file.size > 8 * 1024 * 1024) {
		alert(t('gallery.photoTooLarge'));
		event.target.value = '';
		return;
	}

	selectedPhotoFile = await compressImage(file, 1600, 0.8);
	const reader = new FileReader();
	reader.onload = e => {
		document.getElementById('photoPreview').src = e.target.result;
		document.getElementById('photoPreviewWrap').style.display = 'block';
	};
	reader.readAsDataURL(selectedPhotoFile);
}

function clearSelectedPhoto() {
	selectedPhotoFile = null;
	document.getElementById('photoInput').value = '';
	document.getElementById('photoPreviewWrap').style.display = 'none';
	document.getElementById('photoPreview').src = '';
}

async function uploadSessionPhoto(ts) {
	if (!selectedPhotoFile) return null;
	const extMatch = /\.([a-zA-Z0-9]+)$/.exec(selectedPhotoFile.name);
	const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
	const path = `${currentUser.id}/${ts}.${ext}`;

	const { error } = await supabaseClient.storage
		.from('session-photos')
		.upload(path, selectedPhotoFile, { upsert: true, contentType: selectedPhotoFile.type || 'image/jpeg' });

	if (error) { console.error('Errore upload foto:', error); return null; }
	return path;
}

// ========== GALLERIA FOTO ==========
// Thumbnail via Supabase Image Transformations: 300x300 invece dell'originale a piena
// risoluzione. Richiede piano Pro+ (progetto attuale: Free, verificato via MCP il
// 2026-08-21) — su Free la richiesta fallirebbe sempre, aggiungendo un round-trip
// fallito ad ogni foto prima del fallback. Tenuto spento finché non si passa a Pro:
// basta girare questo flag a true (e abilitare il toggle in Storage > Settings).
const SUPABASE_IMAGE_TRANSFORMS_ENABLED = false;
const GALLERY_THUMB_TRANSFORM = { width: 300, height: 300, resize: 'cover', quality: 70 };
const GALLERY_VIEWER_TRANSFORM = { width: 1600, quality: 80 };

function transformOpts(transform) {
	return SUPABASE_IMAGE_TRANSFORMS_ENABLED ? { transform } : {};
}

async function fallbackPlainPhoto(img) {
	if (img.dataset.fallbackDone) return;
	img.dataset.fallbackDone = '1';
	const path = img.dataset.path;
	if (!path) return;
	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrl(path, 3600);
	if (!error && data) img.src = data.signedUrl;
}

// Modalità galleria (redesign 2026, handoff 2h): 'grid' (miniature 3 col) o
// 'feed' (card 4:3). Persistita in localStorage 'jt_gallery_mode'.
function galleryMode() {
	try { return localStorage.getItem('jt_gallery_mode') === 'feed' ? 'feed' : 'grid'; } catch (e) { return 'grid'; }
}
function setGalleryMode(m) {
	try { localStorage.setItem('jt_gallery_mode', m); } catch (e) {}
	loadGallery();
}

async function loadGallery() {
	const el = document.getElementById('galleryGrid');
	if (!el) return;

	const mode = galleryMode();
	el.className = mode === 'feed' ? 'gallery-feed' : 'gallery-grid';
	document.querySelectorAll('#galleryModeToggle button').forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
	el.innerHTML = '<div class="spinner"></div>';

	const withPhotos = [...smokes].filter(s => s.photo_path).sort((a, b) => b.ts - a.ts);

	if (withPhotos.length === 0) {
		el.innerHTML = `<p class="gallery-empty">${t('gallery.noPhotosYet')}</p>`;
		return;
	}

	const paths = withPhotos.map(s => s.photo_path);
	const transform = mode === 'feed' ? GALLERY_VIEWER_TRANSFORM : GALLERY_THUMB_TRANSFORM;
	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrls(paths, 3600, transformOpts(transform));

	if (error || !data) {
		el.innerHTML = `<p class="gallery-empty">${t('gallery.loadPhotosError')}</p>`;
		return;
	}

	if (mode === 'feed') {
		const av = avatarMarkup(isGuestMode ? getGuestAvatar() : (currentUserProfile?.avatar_url || null), currentUserProfile?.username || '', 34);
		const myName = escapeHtml(currentUserProfile?.username || t('shared.you'));
		el.innerHTML = withPhotos.map((s, i) => {
			const signed = data[i]?.signedUrl;
			if (!signed) return '';
			const place = s.location_name ? ` · 📍 ${escapeHtml(s.location_name)}` : '';
			const typeLabel = s.type === 'fumo' ? t('common.smoke') : s.type === 'erba' ? t('common.weed') : t('common.smokeWeed');
			return `
				<article class="gallery-feed-card">
					<div class="gallery-feed-head">
						${av}
						<div class="gallery-feed-who">
							<span class="gallery-feed-name">${myName}</span>
							<span class="gallery-feed-when">${formatShortDate(s.date)} · ${s.time}${place}</span>
						</div>
					</div>
					<button type="button" class="gallery-feed-imgwrap" onclick="openPhotoViewer(${s.ts})">
						<img class="gallery-feed-img" src="${signed}" data-path="${s.photo_path}" onerror="fallbackPlainPhoto(this)" loading="lazy" alt="">
					</button>
					<div class="gallery-feed-meta">
						<span class="gallery-feed-pill">${typeLabel} · ${fmtNum(personalGrams(s), 2, 0)}g</span>
						${s.context_tag ? `<span class="gallery-feed-pill">${escapeHtml(s.context_tag)}</span>` : ''}
					</div>
				</article>
			`;
		}).join('');
		return;
	}

	el.innerHTML = withPhotos.map((s, i) => {
		const signed = data[i]?.signedUrl;
		if (!signed) return '';
		return `
			<button type="button" class="gallery-thumb" onclick="openPhotoViewer(${s.ts})">
				<img src="${signed}" data-path="${s.photo_path}" onerror="fallbackPlainPhoto(this)" loading="lazy" alt="">
			</button>
		`;
	}).join('');
}

let currentViewerTs = null;

async function openPhotoViewer(ts) {
	const session = smokes.find(s => s.ts === ts);
	if (!session || !session.photo_path) return;

	currentViewerTs = ts;
	document.getElementById('photoViewerImg').removeAttribute('src'); // non src='': stringa vuota risolve all'URL della pagina e spara un error event spurio, che ora verrebbe intercettato dall'onerror di fallbackPlainPhoto
	document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--color-text-muted);">${t('common.loading')}</p>`;
	document.getElementById('photoViewerDeleteBtn').style.display = 'block';
	document.getElementById('photoViewerModal').style.display = 'flex';

	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrl(session.photo_path, 3600, transformOpts(GALLERY_VIEWER_TRANSFORM));

	if (error || !data) {
		document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--danger);">${t('gallery.loadPhotoError')}</p>`;
		return;
	}

	const viewerImg = document.getElementById('photoViewerImg');
	viewerImg.dataset.path = session.photo_path;
	viewerImg.dataset.fallbackDone = '';
	viewerImg.onerror = () => fallbackPlainPhoto(viewerImg);
	viewerImg.src = data.signedUrl;
	document.getElementById('photoViewerInfo').innerHTML = `
		<strong>${formatShortDate(session.date)} · ${session.time}</strong><br>
		<span style="color:var(--color-text-muted); font-size:13px;">
			${session.type === 'fumo' ? t('common.smoke') : session.type === 'erba' ? t('common.weed') : t('common.smokeWeed')} · ${fmtNum(personalGrams(session), 2, 0)}g
			${session.location_name ? ' · 📍 ' + escapeHtml(session.location_name) : ''}
		</span>
	`;
}

// ========== FEED ISTANTANEE (foto tue + amici) ==========
let feedItems = [];
let feedHasFriends = null; // null = sconosciuto, bool dopo il primo load

// Sezione istantanee a tendina. Stato persistito in localStorage 'jt_feed_collapsed'
// ('1' = chiusa). Default aperta. Il feed è lazy: non si carica finché la sezione
// non è aperta (evita il round-trip di get_snapshot_feed + signed URL se guardi
// solo la classifica).
function feedCollapsedPref() {
	try { return localStorage.getItem('jt_feed_collapsed') === '1'; } catch (e) { return false; }
}

function toggleSnapshotFeed(forceOpen) {
	const panel = document.getElementById('snapshotFeedPanel');
	const btn = document.getElementById('snapshotFeedToggle');
	if (!panel || !btn) return;
	const open = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
	panel.classList.toggle('open', open);
	btn.classList.toggle('is-open', open);
	btn.setAttribute('aria-expanded', String(open));
	try { localStorage.setItem('jt_feed_collapsed', open ? '0' : '1'); } catch (e) {}
	// apertura manuale (utente) → carica il feed se non è già stato caricato in questa visita
	if (open && typeof forceOpen !== 'boolean' && !isGuestMode && currentUser) loadFeed();
}

async function loadFeed() {
	const el = document.getElementById('snapshotFeed');
	if (!el) return;
	el.innerHTML = '<div class="spinner"></div>';

	const { data, error } = await supabaseClient.rpc('get_snapshot_feed', { limit_count: 20 });
	if (error) {
		console.error('Errore feed:', error);
		el.innerHTML = `<p class="feed-empty">${t('feed.loadError')}</p>`;
		return;
	}
	feedItems = (data || []).map(it => ({ ...it, comments: null, commentsOpen: false }));

	if (feedItems.length === 0) {
		feedHasFriends = await hasAcceptedFriends();
		el.innerHTML = feedHasFriends
			? `<p class="feed-empty">${t('feed.emptyNoSnapshots')}</p>`
			: feedEmptyNoFriendsHtml();
		bindFeedDelegation(el);
		return;
	}

	const paths = feedItems.map(s => s.photo_path);
	const { data: signed, error: sErr } = await supabaseClient.storage
		.from('session-photos')
		.createSignedUrls(paths, 3600, transformOpts(GALLERY_THUMB_TRANSFORM));
	if (sErr || !signed) {
		el.innerHTML = `<p class="feed-empty">${t('feed.loadError')}</p>`;
		return;
	}
	feedItems.forEach((it, i) => { it.signedUrl = signed[i]?.signedUrl || null; });

	renderFeed();
}

async function hasAcceptedFriends() {
	const { data, error } = await supabaseClient
		.from('friendships')
		.select('id')
		.eq('user_id', currentUser.id)
		.eq('status', 'accepted')
		.limit(1);
	if (error) { console.error('friendships check:', error); return true; } // in dubbio, non mostrare la CTA
	return (data || []).length > 0;
}

function feedEmptyNoFriendsHtml() {
	return `
		<div class="feed-empty feed-empty-cta">
			<p class="feed-empty-title">${t('feed.emptyNoFriendsTitle')}</p>
			<p>${t('feed.emptyNoFriendsCta')}</p>
			<button type="button" class="action-btn" data-action="add-friend-cta">${t('feed.addFriendBtn')}</button>
		</div>`;
}

function renderFeed() {
	const el = document.getElementById('snapshotFeed');
	if (!el) return;
	el.innerHTML = feedItems.map((it, i) => feedCardHtml(it, i)).join('');
	bindFeedDelegation(el);
}

// Istante della sessione (data + ora scelte dall'utente, ora locale), non quello del
// salvataggio (ts): una sessione registrata a posteriori con foto risultava "Adesso".
function sessionMoment(date, time) {
	const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
	const hm = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '00:00';
	return new Date(`${date}T${hm}:00`);
}

function feedCardHtml(it, index) {
	const mine = it.user_id === currentUser.id;
	const name = mine ? t('feed.you') : escapeHtml(it.username || '?');
	const avatar = avatarMarkup(it.avatar_url, it.username, 30);
	const when = formatNotifTime(sessionMoment(it.date, it.time));
	const counts = reactionCountsHtml(it.reaction_summary);
	const img = it.signedUrl
		? `<img class="feed-img" src="${it.signedUrl}" data-path="${it.photo_path}" onerror="fallbackPlainPhoto(this)" loading="lazy" alt="">`
		: `<div class="feed-img feed-img-missing"></div>`;
	return `
		<article class="feed-card" data-index="${index}" data-snapshot-id="${it.id}">
			<header class="feed-head">
				${avatar}
				<span class="feed-name">${name}</span>
				<span class="feed-when">${when}</span>
			</header>
			<div class="feed-img-wrap" data-action="open-viewer" data-index="${index}">${img}</div>
			${counts ? `<div class="feed-counts">${counts}</div>` : ''}
			<div class="feed-actions">
				<div class="feed-react">
					<button type="button" class="feed-react-btn${it.my_reaction ? ' is-active' : ''}" data-action="react-tap" data-index="${index}">
						<span class="feed-react-emoji">${it.my_reaction ? REACTION_EMOJI[it.my_reaction] : '🤍'}</span>
						<span class="feed-react-label">${it.my_reaction ? '' : t('feed.react')}</span>
					</button>
					<button type="button" class="feed-react-caret" data-action="react-palette" data-index="${index}" aria-label="${t('feed.reactionsA11y')}">⌄</button>
				</div>
				<button type="button" class="feed-comment-btn" data-action="toggle-comments" data-index="${index}">
					💬 <span class="feed-comment-count">${it.comment_count}</span>
				</button>
			</div>
			<div class="feed-comments" data-comments-for="${index}" hidden></div>
		</article>`;
}

const REACTION_EMOJI = { heart: '❤️', fire: '🔥', joy: '😂', wow: '😮', clap: '👏' };
const REACTION_ORDER = ['heart', 'fire', 'joy', 'wow', 'clap'];

function reactionCountsHtml(summary) {
	if (!summary || typeof summary !== 'object') return '';
	return REACTION_ORDER
		.filter(k => summary[k] > 0)
		.map(k => `<span class="feed-count">${REACTION_EMOJI[k]} ${summary[k]}</span>`)
		.join('');
}

function refreshFeedCard(index) {
	const el = document.getElementById('snapshotFeed');
	const card = el && el.querySelector(`.feed-card[data-index="${index}"]`);
	if (!card) return;
	const it = feedItems[index];
	if (!it) return;
	const wasOpen = it.commentsOpen;
	const draft = card.querySelector('.feed-comment-input')?.value;
	card.outerHTML = feedCardHtml(it, index);
	if (wasOpen && typeof toggleComments === 'function') toggleComments(index, true); // toggleComments → Task 9
	if (typeof draft === 'string' && draft !== '') {
		const input = document.querySelector(`#snapshotFeed .feed-comments[data-comments-for="${index}"] .feed-comment-input`);
		if (input) {
			input.value = draft;
			input.focus();
			input.setSelectionRange(draft.length, draft.length);
		}
	}
}

// Reazione ottimistica con rollback: applico subito in locale, poi confermo via RPC.
async function applyReaction(index, type) {
	const it = feedItems[index];
	if (!it) return;
	const prevSummary = it.reaction_summary;
	const prevMine = it.my_reaction;
	it.reaction_summary = adjustSummary(prevSummary, prevMine, type);
	it.my_reaction = type;
	refreshFeedCard(index);
	const { data, error } = await supabaseClient.rpc('set_snapshot_reaction', {
		p_snapshot_id: it.id, p_reaction_type: type
	});
	if (error) {
		it.reaction_summary = prevSummary;
		it.my_reaction = prevMine;
		refreshFeedCard(index);
		showMessage(t('feed.loadError'));
		return;
	}
	it.reaction_summary = data || {};
	refreshFeedCard(index);
}

async function clearReaction(index) {
	const it = feedItems[index];
	if (!it || !it.my_reaction) return;
	const prevSummary = it.reaction_summary;
	const prevMine = it.my_reaction;
	it.reaction_summary = adjustSummary(prevSummary, prevMine, null);
	it.my_reaction = null;
	refreshFeedCard(index);
	const { data, error } = await supabaseClient.rpc('remove_snapshot_reaction', { p_snapshot_id: it.id });
	if (error) {
		it.reaction_summary = prevSummary;
		it.my_reaction = prevMine;
		refreshFeedCard(index);
		showMessage(t('feed.loadError'));
		return;
	}
	it.reaction_summary = data || {};
	refreshFeedCard(index);
}

// Pura: clona il summary, decrementa/rimuove oldType, incrementa newType (newType null = solo rimozione).
function adjustSummary(summary, oldType, newType) {
	const s = { ...(summary || {}) };
	if (oldType && s[oldType]) {
		s[oldType]--;
		if (s[oldType] <= 0) delete s[oldType];
	}
	if (newType) s[newType] = (s[newType] || 0) + 1;
	return s;
}

let openPalette = null; // { index, node }

function openReactionPalette(index, anchorEl) {
	closeReactionPalette();
	if (!anchorEl) return;
	const pal = document.createElement('div');
	pal.className = 'feed-palette';
	pal.setAttribute('role', 'menu');
	pal.innerHTML = REACTION_ORDER.map(k =>
		`<button type="button" class="feed-palette-btn" role="menuitem" data-react="${k}" aria-label="${t('feed.reactionName.' + k)}">${REACTION_EMOJI[k]}</button>`
	).join('');
	document.body.appendChild(pal);
	const r = anchorEl.getBoundingClientRect();
	pal.style.top = `${window.scrollY + r.top - pal.offsetHeight - 8}px`;
	pal.style.left = `${window.scrollX + r.left}px`;
	pal.addEventListener('click', (e) => {
		const b = e.target.closest('[data-react]');
		if (!b) return;
		applyReaction(index, b.dataset.react);
		closeReactionPalette();
	});
	openPalette = { index, node: pal };
	setTimeout(() => {
		document.addEventListener('click', paletteOutside);
		document.addEventListener('scroll', closeReactionPalette, { once: true, capture: true });
		document.addEventListener('keydown', paletteEsc);
	}, 0);
}

function paletteOutside(e) {
	if (openPalette && !openPalette.node.contains(e.target)) closeReactionPalette();
}
function paletteEsc(e) {
	if (e.key === 'Escape') closeReactionPalette();
}
function closeReactionPalette() {
	if (!openPalette) return;
	openPalette.node.remove();
	openPalette = null;
	document.removeEventListener('keydown', paletteEsc);
	document.removeEventListener('click', paletteOutside);
	document.removeEventListener('scroll', closeReactionPalette, { capture: true });
}

let feedDelegationBound = false;
let pressTimer = null;
let pressFired = false;
let pressStart = null;

function bindFeedDelegation(el) {
	if (feedDelegationBound) return;
	feedDelegationBound = true;
	el.addEventListener('click', onFeedClick);
	el.addEventListener('keydown', onFeedKeydown);
	el.addEventListener('pointerdown', onFeedPointerDown);
	el.addEventListener('pointerup', onFeedPointerUp);
	el.addEventListener('pointercancel', cancelPress);
	el.addEventListener('pointermove', onFeedPointerMove);
}

function onFeedKeydown(e) {
	const ta = e.target.closest('.feed-comment-input');
	if (!ta) return;
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		submitComment(Number(ta.dataset.index));
	}
}

function onFeedPointerDown(e) {
	const btn = e.target.closest('[data-action="react-tap"]');
	if (!btn) return;
	if (e.target.closest('[data-action="react-palette"]')) return; // il caret lo gestisce il click
	pressFired = false;
	pressStart = { x: e.clientX, y: e.clientY };
	const index = Number(btn.dataset.index);
	const anchor = btn.closest('.feed-react');
	clearTimeout(pressTimer);
	pressTimer = setTimeout(() => {
		pressFired = true;
		openReactionPalette(index, anchor);
	}, 450);
}
function onFeedPointerMove(e) {
	if (!pressStart) return;
	if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
}
function onFeedPointerUp() {
	clearTimeout(pressTimer);
	pressTimer = null;
	pressStart = null;
}
function cancelPress() {
	clearTimeout(pressTimer);
	pressTimer = null;
	pressStart = null;
}

function onFeedClick(e) {
	const target = e.target.closest('[data-action]');
	if (!target) return;
	const action = target.dataset.action;
	const index = Number(target.dataset.index);
	if (action === 'add-friend-cta') {
		const input = document.getElementById('friendUsername');
		if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
		return;
	}
	if (action === 'open-viewer') { openSnapshotViewer(index); return; }
	if (action === 'react-palette') { openReactionPalette(index, e.target.closest('.feed-react')); return; }
	if (action === 'react-tap') {
		if (pressFired) {
			pressFired = false;
			e.stopPropagation(); // non far propagare al listener outside-click che chiuderebbe la palette appena aperta
			return;
		}
		const it = feedItems[index];
		if (!it) return;
		if (it.my_reaction) clearReaction(index); else applyReaction(index, 'heart');
		return;
	}
	if (action === 'toggle-comments') { toggleComments(index); return; }
	if (action === 'send-comment') { submitComment(index); return; }
	if (action === 'delete-comment') { removeComment(index, Number(target.dataset.commentId)); return; }
}

// ---- Commenti (thread piatto) ----
async function toggleComments(index, forceOpen) {
	const it = feedItems[index];
	if (!it) return;
	const box = document.querySelector(`#snapshotFeed .feed-comments[data-comments-for="${index}"]`);
	if (!box) return;
	const open = forceOpen || !it.commentsOpen;
	it.commentsOpen = open;
	box.hidden = !open;
	if (!open) return;
	if (it.comments === null) {
		box.innerHTML = '<div class="spinner"></div>';
		const { data, error } = await supabaseClient.rpc('get_snapshot_comments', { p_snapshot_id: it.id });
		it.comments = error ? [] : (data || []);
	}
	renderComments(index);
}

function renderComments(index) {
	const it = feedItems[index];
	const box = document.querySelector(`#snapshotFeed .feed-comments[data-comments-for="${index}"]`);
	if (!box) return;
	const list = (it.comments || []).map(c => `
		<div class="feed-comment" data-comment-id="${c.id}">
			${avatarMarkup(c.avatar_url, c.username, 22)}
			<div class="feed-comment-main">
				<span class="feed-comment-name">${c.is_mine ? t('feed.you') : escapeHtml(c.username || '?')}</span>
				<span class="feed-comment-body">${escapeHtml(c.body)}</span>
				<span class="feed-comment-when">${formatNotifTime(c.created_at)}</span>
				${c.is_mine ? `<button type="button" class="feed-comment-del" data-action="delete-comment" data-index="${index}" data-comment-id="${c.id}" aria-label="${t('feed.deleteCommentConfirm')}">🗑</button>` : ''}
			</div>
		</div>`).join('');
	box.innerHTML = `
		<div class="feed-comment-list">${list}</div>
		<div class="feed-comment-form">
			<textarea class="feed-comment-input" rows="1" maxlength="500" placeholder="${t('feed.commentPlaceholder')}" data-index="${index}"></textarea>
			<button type="button" class="action-btn feed-comment-send" data-action="send-comment" data-index="${index}">${t('feed.send')}</button>
		</div>`;
}

async function submitComment(index) {
	const it = feedItems[index];
	const box = document.querySelector(`#snapshotFeed .feed-comments[data-comments-for="${index}"]`);
	const input = box && box.querySelector('.feed-comment-input');
	const sendBtn = box && box.querySelector('.feed-comment-send');
	if (!it || !input) return;
	const body = input.value.trim();
	if (!body) return;
	input.disabled = true;
	if (sendBtn) sendBtn.disabled = true;
	const { data, error } = await supabaseClient.rpc('add_snapshot_comment', { p_snapshot_id: it.id, p_body: body });
	input.disabled = false;
	if (sendBtn) sendBtn.disabled = false;
	if (error) { showMessage(t('feed.loadError')); return; }
	const row = Array.isArray(data) ? data[0] : data;
	it.comments = [...(it.comments || []), row];
	it.comment_count = (it.comment_count || 0) + 1;
	input.value = '';
	renderComments(index);
	updateCommentCount(index);
}

async function removeComment(index, commentId) {
	if (!confirm(t('feed.deleteCommentConfirm'))) return;
	const { error } = await supabaseClient.rpc('delete_snapshot_comment', { p_comment_id: commentId });
	if (error) { showMessage(t('feed.loadError')); return; }
	const it = feedItems[index];
	if (!it) return;
	it.comments = (it.comments || []).filter(c => c.id !== commentId);
	it.comment_count = Math.max(0, (it.comment_count || 1) - 1);
	renderComments(index);
	updateCommentCount(index);
}

function updateCommentCount(index) {
	const el = document.querySelector(`#snapshotFeed .feed-card[data-index="${index}"] .feed-comment-count`);
	if (el && feedItems[index]) el.textContent = feedItems[index].comment_count;
}

async function openSnapshotViewer(index) {
	const s = feedItems[index];
	if (!s) return;

	const isMe = s.user_id === currentUser.id;
	currentViewerTs = isMe ? s.ts : null;

	document.getElementById('photoViewerImg').removeAttribute('src'); // non src='': stringa vuota risolve all'URL della pagina e spara un error event spurio, che ora verrebbe intercettato dall'onerror di fallbackPlainPhoto
	document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--color-text-muted);">${t('common.loading')}</p>`;
	document.getElementById('photoViewerDeleteBtn').style.display = isMe ? 'block' : 'none';
	document.getElementById('photoViewerModal').style.display = 'flex';

	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrl(s.photo_path, 3600, transformOpts(GALLERY_VIEWER_TRANSFORM));

	if (error || !data) {
		document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--danger);">${t('gallery.loadPhotoError')}</p>`;
		return;
	}

	const viewerImg = document.getElementById('photoViewerImg');
	viewerImg.dataset.path = s.photo_path;
	viewerImg.dataset.fallbackDone = '';
	viewerImg.onerror = () => fallbackPlainPhoto(viewerImg);
	viewerImg.src = data.signedUrl;
	const grams = personalGrams(s); // stessa formula della Galleria (prima my_f+my_e: 0g sulle righe storiche)
	document.getElementById('photoViewerInfo').innerHTML = `
		<strong>${isMe ? t('shared.you') : escapeHtml(s.username)}</strong> · ${formatShortDate(s.date)} · ${s.time}<br>
		<span style="color:var(--color-text-muted); font-size:13px;">
			${s.type === 'fumo' ? t('common.smoke') : s.type === 'erba' ? t('common.weed') : t('common.smokeWeed')} · ${fmtNum(grams, 2, 0)}g
			${s.location_name ? ' · 📍 ' + escapeHtml(s.location_name) : ''}
		</span>
	`;
}

function closePhotoViewer() {
	document.getElementById('photoViewerModal').style.display = 'none';
	currentViewerTs = null;
}

async function deletePhotoFromViewer() {
	if (!currentViewerTs) return;

	const session = smokes.find(s => s.ts === currentViewerTs);
	if (!session || !session.photo_path) return;

	// se l'istantanea ha reazioni o commenti, avviso esplicito del cascade.
	// dal feed uso i conteggi già in memoria; dalla Galleria (feed non caricato) chiedo al server.
	let hasEngagement;
	const inFeed = feedItems.find(it => it.ts === currentViewerTs);
	if (inFeed) {
		hasEngagement = (inFeed.comment_count || 0) > 0 ||
			Object.values(inFeed.reaction_summary || {}).some(n => n > 0);
	} else {
		try {
			const { data } = await supabaseClient.rpc('snapshot_engagement_counts', { p_snapshot_id: session.id });
			const row = Array.isArray(data) ? data[0] : data;
			hasEngagement = !!row && ((row.reaction_count || 0) > 0 || (row.comment_count || 0) > 0);
		} catch {
			hasEngagement = false;
		}
	}
	const msg = hasEngagement ? t('gallery.deleteSnapshotConfirmWithEngagement') : t('gallery.deletePhotoConfirm');
	if (!confirm(msg)) return;

	await supabaseClient.storage.from('session-photos').remove([session.photo_path]);
	const { error } = await supabaseClient.from('smokes').update({ photo_path: null }).eq('ts', currentViewerTs);

	if (error) { alert(t('gallery.deletePhotoError')); return; }

	closePhotoViewer();
	showMessage(t('gallery.photoRemoved'));
	await loadData();
	await loadGallery();
	// aggiorna il feed solo se la sezione è aperta (altrimenti si ricarica alla prossima apertura)
	const feedPanel = document.getElementById('snapshotFeedPanel');
	if (typeof loadFeed === 'function' && feedPanel && feedPanel.classList.contains('open')) await loadFeed();
}

// ========== MODIFICA POSIZIONE A POSTERIORI ==========
let editingLocationTs = null;
let editLocationPicked = null; // { lat, lng, name } scelto via GPS o posto salvato

function openEditLocationModal(ts) {
	const session = smokes.find(s => s.ts === ts);
	if (!session) return;

	editingLocationTs = ts;
	editLocationPicked = null;

	document.getElementById('editLocationSessionInfo').textContent =
		t('modals.editLocationSessionInfo', { date: formatShortDate(session.date), time: session.time }) +
		(session.location_name ? t('modals.editLocationCurrent', { name: session.location_name }) : t('modals.editLocationNone'));
	document.getElementById('editLocationManualInput').value = session.location_name || '';

	const listEl = document.getElementById('editLocationPlacesList');
	if (userPlaces.length === 0) {
		listEl.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted);">${t('modals.noPlacesUseGpsOrType')}</p>`;
	} else {
		listEl.innerHTML = `
			<label style="margin-top:0; font-size:12px;">${t('modals.yourSavedPlaces')}</label>
			<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
				${userPlaces.map(p => `
					<button type="button" onclick="pickSavedPlaceForEdit(${p.id})"
						style="background:rgba(76,175,80,0.12); border:1px solid rgba(76,175,80,0.3); color:var(--heading); border-radius:20px; padding:6px 12px; font-size:13px; cursor:pointer;">
						📍 ${escapeHtml(p.name)}
					</button>
				`).join('')}
			</div>
		`;
	}

	document.getElementById('editLocationModal').style.display = 'flex';
}

function closeEditLocationModal() {
	document.getElementById('editLocationModal').style.display = 'none';
	editingLocationTs = null;
	editLocationPicked = null;
}

function pickSavedPlaceForEdit(placeId) {
	const place = userPlaces.find(p => p.id === placeId);
	if (!place) return;
	editLocationPicked = { lat: place.latitude, lng: place.longitude, name: place.name };
	document.getElementById('editLocationManualInput').value = place.name;
	showMessage(t('modals.placeSelected', { name: place.name }));
}

function useCurrentLocationForEdit() {
	if (!navigator.geolocation) return alert(t('places.geolocationNotSupported'));

	showMessage(t('modals.locatingPosition'));
	navigator.geolocation.getCurrentPosition(async (position) => {
		const lat = position.coords.latitude;
		const lng = position.coords.longitude;
		let name = null;

		userPlaces.forEach(p => {
			const d = getDist(lat, lng, p.latitude, p.longitude);
			if (d <= (p.radius || 50)) name = p.name;
		});

		if (!name) {
			try {
				const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
				const data = await response.json();
				if (data.address) name = data.address.city || data.address.town || data.address.village || null;
			} catch (e) {
				console.log('Reverse geocoding non disponibile');
			}
		}

		editLocationPicked = { lat, lng, name };
		document.getElementById('editLocationManualInput').value = name || '';
		showMessage(t('modals.locationFound'));
	}, (error) => {
		alert(t('places.locationError', { message: error.message }));
	});
}

async function saveEditedLocation() {
	if (!editingLocationTs) return;
	const manualName = document.getElementById('editLocationManualInput').value.trim();

	const update = editLocationPicked
		? { latitude: editLocationPicked.lat, longitude: editLocationPicked.lng, location_name: manualName || editLocationPicked.name || null }
		: { location_name: manualName || null };

	if (isGuestMode) {
		const guestSmokes = getGuestSmokes();
		const session = guestSmokes.find(s => s.ts === editingLocationTs);
		if (session) Object.assign(session, update);
		setGuestSmokes(guestSmokes);
	} else {
		const { error } = await supabaseClient.from('smokes').update(update).eq('ts', editingLocationTs);
		if (error) { alert(t('modals.locationSaveError')); return; }
	}

	showMessage(t('modals.locationUpdated'));
	closeEditLocationModal();
	await loadData();
}

// ========== STORICO: ricerca e filtri ==========
function getFilteredHistorySmokes() {
	const query = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
	const type = document.getElementById('historyTypeFilter')?.value || 'all';
	const from = document.getElementById('historyDateFrom')?.value || '';
	const to = document.getElementById('historyDateTo')?.value || '';

	return smokes.filter(s => {
		if (type !== 'all' && s.type !== type) return false;
		if (from && s.date < from) return false;
		if (to && s.date > to) return false;
		if (query && !(s.location_name || '').toLowerCase().includes(query)) return false;
		return true;
	});
}

function isHistoryFilterActive() {
	const query = document.getElementById('historySearch')?.value || '';
	const type = document.getElementById('historyTypeFilter')?.value || 'all';
	const from = document.getElementById('historyDateFrom')?.value || '';
	const to = document.getElementById('historyDateTo')?.value || '';
	return !!(query || type !== 'all' || from || to);
}

function applyHistoryFilters() {
	const active = isHistoryFilterActive();
	const resetBtn = document.getElementById('historyFilterReset');
	if (resetBtn) resetBtn.style.display = active ? 'block' : 'none';
	const badge = document.getElementById('historyFilterBadge');
	if (badge) badge.style.display = active ? 'block' : 'none';
	updateHistory();
}

function resetHistoryFilters() {
	const search = document.getElementById('historySearch');
	const type = document.getElementById('historyTypeFilter');
	const from = document.getElementById('historyDateFrom');
	const to = document.getElementById('historyDateTo');
	if (search) search.value = '';
	if (type) type.value = 'all';
	if (from) from.value = '';
	if (to) to.value = '';
	applyHistoryFilters();
}

function toggleHistoryFilterPanel(forceOpen) {
	const panel = document.getElementById('historyFilterPanel');
	const btn = document.getElementById('historyFilterToggle');
	if (!panel || !btn) return;
	const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
	panel.classList.toggle('open', shouldOpen);
	btn.classList.toggle('is-open', shouldOpen);
	btn.setAttribute('aria-expanded', String(shouldOpen));
}

function updateHistory() {
	const hList = document.getElementById("historyList");
	hList.innerHTML = "";

	const filterActive = isHistoryFilterActive();
	const visibleSmokes = filterActive ? getFilteredHistorySmokes() : smokes;

	if (smokes.length === 0) {
		hList.innerHTML = `<p style='text-align:center; color:var(--color-text-muted);'>${t('history.noDataYet')}</p>`;
	} else if (visibleSmokes.length === 0) {
		hList.innerHTML = `<p style='text-align:center; color:var(--color-text-muted);'>${t('history.noResultsForFilters')}</p>`;
	} else {
		const months = t('common.months');
		const byYear = {};

		visibleSmokes.forEach(s => {
			// anno/mese letti dalla stringa "YYYY-MM-DD" (new Date(str) e' la mezzanotte UTC)
			const year = Number(s.date.slice(0, 4));
			const monthIndex = Number(s.date.slice(5, 7)) - 1;
			const monthName = months[monthIndex];
			const mKey = `${monthName} ${year}`;
			
			if (!byYear[year]) byYear[year] = {};
			if (!byYear[year][mKey]) byYear[year][mKey] = {};
			if (!byYear[year][mKey][s.date]) byYear[year][mKey][s.date] = [];
			byYear[year][mKey][s.date].push(s);
		});

		// ANNI DECRESCENTI
		const years = Object.keys(byYear).sort((a, b) => b - a);

		years.forEach(year => {
			let yearGrams = 0;
			let monthsHtml = "";

			// MESI DECRESCENTI (più recente primo)
			const monthKeysWithDates = Object.keys(byYear[year]).map(mKey => {
				const firstDateOfMonth = Math.max(...Object.keys(byYear[year][mKey]).map(dayNum));
				return { mKey, firstDateOfMonth };
			});
			const monthKeys = monthKeysWithDates.sort((a, b) => b.firstDateOfMonth - a.firstDateOfMonth).map(x => x.mKey);

			monthKeys.forEach(mKey => {
				let mGrams = 0;
				let daysHtml = "";

				// GIORNI DECRESCENTI (più recente primo)
				const dayKeys = Object.keys(byYear[year][mKey]).sort((a, b) => b.localeCompare(a));
				
				dayKeys.forEach(dKey => {
					const daySmokes = byYear[year][mKey][dKey];
					const dayWeight = daySmokes.reduce((sum, s) => sum + personalGrams(s), 0);
					mGrams += dayWeight;
					yearGrams += dayWeight;

					const dDisplay = formatShortDate(dKey);

					// SESSIONI DECRESCENTI PER ORA
					const sortedSmokes = [...daySmokes].sort((a, b) => b.time.localeCompare(a.time));

					let itemsHtml = sortedSmokes.map(s => `
    <div class="history-item">
        <div>
            <span style="font-weight: bold; color: var(--primary);">${escapeHtml(s.time)}</span> - <b>${s.type === 'fumo' ? '🍫' : s.type === 'erba' ? '🍃' : '🍫🍃'}</b> ${fmtNum(personalGrams(s), 2, 0)}g
            ${s.not_mine ? `<span style="background:var(--warning-bg); color:var(--warning-text); font-size:11px; padding:1px 7px; border-radius:20px; margin-left:4px; font-weight:600;">${t('history.notMineBadge')}</span>` : ''}
            <br><small style="color: var(--color-text-muted);">${s.location_name ? `📍 ${escapeHtml(s.location_name)}` : `📍 <em>${t('history.noLocation')}</em>`} <button type="button" onclick="openEditLocationModal(${s.ts})" style="background:none; border:none; padding:0; margin:0; font:inherit; color:var(--primary-light); cursor:pointer; text-decoration:underline;">${t('history.editLink')}</button>${s.photo_path ? ` · <button type="button" onclick="openPhotoViewer(${s.ts})" style="background:none; border:none; padding:0; margin:0; font:inherit; cursor:pointer;">📷</button>` : ''}</small>
        </div>
        <button class="del-btn" onclick="deleteItem(${s.ts})">🗑️</button>
    </div>
`).join('');

					// TUTTO CHIUSO (display: none)
					daysHtml += `
						<div class="day-group">
							<div class="day-header" onclick="toggleAccordion(this)">
								<span>📅 ${dDisplay}</span>
								<span>${fmtNum(dayWeight, 1)}g <span class="chevron">▼</span></span>
							</div>
							<div class="day-content" style="display: none;">${itemsHtml}</div>
						</div>`;
				});

				// TUTTO CHIUSO (display: none)
				monthsHtml += `
					<div class="month-group">
						<div class="month-header" onclick="toggleAccordion(this)">
							<span>📂 ${mKey}</span>
							<span>${fmtNum(mGrams, 1)}g <span class="chevron">▼</span></span>
						</div>
						<div class="month-content" style="display: none;">${daysHtml}</div>
					</div>`;
			});

			// TUTTO CHIUSO (display: none)
			hList.innerHTML += `
				<div class="year-group">
					<div class="year-header" onclick="toggleAccordion(this)">
						<span>📅 ${year}</span>
						<span>${fmtNum(yearGrams, 1)}g <span class="chevron">▼</span></span>
					</div>
					<div class="year-content" style="display: none;">${monthsHtml}</div>
				</div>`;
		});
	}
}

	function updateStats() {
		// "Quantità Totali" rispetta il toggle periodo (30d / anno / sempre);
		// le "Medie Reali" e lo streak restano su tutto lo storico (come da etichetta).
		const periodSmokes = smokesForStatsPeriod();
		let totF = 0, totE = 0;
		periodSmokes.forEach(s => {
			const p = personalSplit(s);
			totF += p.fumo;
			totE += p.erba;
		});

		const animate = statsAnimateOnce;
		statsAnimateOnce = false;
		if (animate) {
			animateCount(document.getElementById("sFumo"), totF, 2);
			animateCount(document.getElementById("sErba"), totE, 2);
			animateCount(document.getElementById("sJTot"), periodSmokes.length, 0);
			animateCount(document.getElementById("sGTot"), totF + totE, 2);
		} else {
			document.getElementById("sFumo").innerText = fmtNum(totF, 2);
			document.getElementById("sErba").innerText = fmtNum(totE, 2);
			document.getElementById("sJTot").innerText = fmtNum(periodSmokes.length, 0);
			document.getElementById("sGTot").innerText = fmtNum(totF + totE, 2);
		}

		// Giorni di calendario dalla prima sessione a oggi: "daysSinceFirst" per il testo
		// ("N giorni fa", prima mostrava N+1), "diffDays" (oggi incluso) come divisore delle medie.
		let daysSinceFirst = 0;
		if (smokes.length > 0) {
			const firstDate = smokes.reduce((min, s) => (s.date < min ? s.date : min), smokes[0].date);
			daysSinceFirst = Math.max(0, daysBetween(firstDate, todayStr()));
		}
		const diffDays = daysSinceFirst + 1;
		document.getElementById("streakFootnoteText").textContent = daysSinceFirst === 0
			? t('stats.streakFootnoteToday')
			: tn('stats.streakFootnote', daysSinceFirst, { days: daysSinceFirst });

		// Medie su TUTTO lo storico, numeratore e denominatore (prima i grammi seguivano il
		// filtro periodo mentre i giorni no: 1 g/giorno fisso mostrava 0,11 g col filtro 30gg).
		const allGrams = smokes.reduce((sum, s) => sum + personalGrams(s), 0);
		document.getElementById("avgDaily").innerText = fmtNum(smokes.length / diffDays, 2);
		document.getElementById("avgMonthly").innerText = fmtNum((smokes.length / diffDays) * 30.44, 1);
		document.getElementById("avgYearly").innerText = fmtNum((smokes.length / diffDays) * 365.25, 1);
		document.getElementById("avgGrams").innerText = fmtNum(allGrams / diffDays, 2) + "g";

		const streak = calculateStreak();
		const box = document.getElementById("streakBox");
		if (streak >= 3) {
			document.getElementById("streakDays").innerText = streak;
			updateBestStreak(streak).then(best => {
				document.getElementById("bestStreak").innerText = best;
			});
			box.style.display = "grid";
		} else {
			box.style.display = "none";
		}

		updateStatsPlaces();
	}

	// Giorni di calendario distinti con almeno una sessione, ordinati e convertiti in dayNum()
	// (interi senza scarti DST: prima 29->30/03 valeva 0,958 giorni e spezzava la serie).
	function sessionDayNums() {
		return [...new Set(smokes.map(s => s.date))].sort().map(dayNum);
	}

	function calculateStreak() {
		if (smokes.length === 0) return 0;

		const days = sessionDayNums();
		// la serie e' "viva" se l'ultima sessione e' di oggi o di ieri
		if (dayNum(todayStr()) - days[days.length - 1] > 1) return 0;

		let streak = 1;
		for (let i = days.length - 1; i > 0; i--) {
			if (days[i] - days[i - 1] === 1) streak++;
			else break;
		}
		return streak;
	}

	// Miglior streak calcolato in locale dallo storico (nessuna scrittura DB, a
	// differenza di updateBestStreak): Home "record N" e traguardi streak_*.
	function longestStreak() {
		if (smokes.length === 0) return 0;
		const days = sessionDayNums();
		let best = 1, run = 1;
		for (let i = 1; i < days.length; i++) {
			if (days[i] - days[i - 1] === 1) { run++; if (run > best) best = run; }
			else run = 1;
		}
		return best;
	}

	async function updateBestStreak(currentStreak) {
		// Il record reale dallo storico (longestStreak) prevale su un best_streak salvato piu'
		// basso: prima si aggiornava solo dallo streak corrente e restava indietro (44 vs 108).
		currentStreak = Math.max(currentStreak, longestStreak());
		if (isGuestMode) {
			let best = 0;
			try { best = parseInt(localStorage.getItem('jt_guest_best_streak') || '0', 10) || 0; } catch (e) {}
			if (currentStreak > best) {
				best = currentStreak;
				try { localStorage.setItem('jt_guest_best_streak', String(best)); } catch (e) {}
			}
			return best;
		}

		const { data } = await supabaseClient.from('user_stats').select('best_streak').eq('user_id', currentUser.id).maybeSingle();

		let best = data?.best_streak || 0;
		if (currentStreak > best) {
			await supabaseClient.from('user_stats').upsert({
				user_id: currentUser.id,
				best_streak: currentStreak
			}, { onConflict: 'user_id' });
			best = currentStreak;
		}
		return best;
	}

	function updateStatsPlaces() {
    const el = document.getElementById('statsPlaces');
    if (!el) return;

    // Raggruppa tutte le sessioni per location_name
    const grouped = {};
    smokes.forEach(s => {
        const name = s.location_name || t('stats.unknownPlace');
        if (!grouped[name]) grouped[name] = { j: 0, fumo: 0, erba: 0 };
        const p = personalSplit(s);
        grouped[name].j++;
        grouped[name].fumo += p.fumo;
        grouped[name].erba += p.erba;
    });

    if (Object.keys(grouped).length === 0) {
        el.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('stats.noDataWithLocation')}</p>`;
        return;
    }

    const savedNames = userPlaces.map(p => p.name);

    // Dividi in salvati e altri
    const saved = Object.entries(grouped).filter(([name]) => savedNames.includes(name));
    const others = Object.entries(grouped).filter(([name]) => !savedNames.includes(name));

    // Ordina per numero di joint decrescente
    saved.sort((a, b) => b[1].j - a[1].j);
    others.sort((a, b) => b[1].j - a[1].j);

    const renderRow = ([name, data], isSaved) => `
        <div style="display:flex; justify-content:space-between; align-items:center; 
                    padding: 12px; margin-bottom: 8px; border-radius: 12px;
                    background: ${isSaved ? 'rgba(76,175,80,0.08)' : 'rgba(var(--overlay-rgb),0.05)'};
                    border: 1px solid ${isSaved ? 'rgba(76,175,80,0.2)' : 'rgba(var(--overlay-rgb),0.07)'};">
            <div>
                <span style="font-weight:600; font-size:14px;">${isSaved ? '📍' : '🌍'} ${escapeHtml(name)}</span><br>
                <small style="color:var(--color-text-muted);">🍫 ${fmtNum(data.fumo, 1)}g &nbsp; 🍃 ${fmtNum(data.erba, 1)}g</small>
            </div>
            <div style="text-align:right;">
                <span style="font-size:18px; font-weight:700; color:var(--primary);">${data.j}</span><br>
                <small style="color:var(--color-text-muted);">${t('stats.jointUnit')}</small>
            </div>
        </div>
    `;

    let html = '';

    if (saved.length > 0) {
        html += saved.map(e => renderRow(e, true)).join('');
    }

    if (others.length > 0) {
        if (saved.length > 0) {
            html += '<hr style="margin: 12px 0;">';
        }
        html += others.map(e => renderRow(e, false)).join('');
    }

    el.innerHTML = html;
}

	// Redesign 2026 §2e "Charts": Chart.js resta, si ri-tematizza soltanto —
	// griglia tenue, tick 11px --muted, niente "chart junk", accento verde.
	// Chiamata a ogni renderCharts() così segue il tema corrente.
	function applyChartDefaults() {
		if (typeof Chart === 'undefined') return;
		const cs = getComputedStyle(document.documentElement);
		const muted = cs.getPropertyValue('--color-text-muted').trim() || '#8a978a';
		const dark = document.documentElement.getAttribute('data-theme') === 'dark';
		const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

		Chart.defaults.color = muted;
		Chart.defaults.font.size = 11;
		Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
		Chart.defaults.borderColor = grid;

		Chart.defaults.scale.grid.color = grid;
		Chart.defaults.scale.grid.drawTicks = false;
		Chart.defaults.scale.border.display = false;
		Chart.defaults.scale.ticks.padding = 8;
		Chart.defaults.scale.ticks.maxRotation = 0;

		Chart.defaults.plugins.legend.display = false;
		Chart.defaults.plugins.legend.labels.boxWidth = 12;
		Chart.defaults.plugins.legend.labels.boxHeight = 12;
		Chart.defaults.plugins.legend.labels.usePointStyle = true;

		Chart.defaults.plugins.tooltip.backgroundColor = dark ? '#161d16' : '#ffffff';
		Chart.defaults.plugins.tooltip.titleColor = dark ? '#eef2ee' : '#1c1c1e';
		Chart.defaults.plugins.tooltip.bodyColor = muted;
		Chart.defaults.plugins.tooltip.borderColor = grid;
		Chart.defaults.plugins.tooltip.borderWidth = 1;
		Chart.defaults.plugins.tooltip.padding = 10;
		Chart.defaults.plugins.tooltip.cornerRadius = 10;
		Chart.defaults.plugins.tooltip.displayColors = false;

		Chart.defaults.elements.line.borderWidth = 3;
		Chart.defaults.elements.line.borderCapStyle = 'round';
		Chart.defaults.elements.line.borderJoinStyle = 'round';
		Chart.defaults.elements.line.tension = 0.35;
		Chart.defaults.elements.point.radius = 0;
		Chart.defaults.elements.point.hoverRadius = 5;
		Chart.defaults.elements.bar.borderRadius = 5;
		Chart.defaults.elements.bar.borderSkipped = false;
	}

	function renderCharts() {
		renderCalendarHeatmap();

		// Chart.js viene caricato solo quando si apre la pagina Grafici (vedi loadChartJs()):
		// finché non è pronto, ci si ferma qui e si ridisegna quando refreshPageDynamicContent lo richiama.
		if (typeof Chart === 'undefined') return;

		applyChartDefaults();

		Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
		charts = {};

		let gramsFumo = 0, gramsErba = 0;
		smokes.forEach(s => { const p = personalSplit(s); gramsFumo += p.fumo; gramsErba += p.erba; });

// Grafico a ciambella
const ctxPie = document.getElementById("cPie");
if (ctxPie) {
	charts.pie = new Chart(ctxPie, {
		type: 'doughnut',
		data: {
			labels: [t('charts.labelSmoke'), t('charts.labelWeed')],
			datasets: [{
				data: [gramsFumo, gramsErba],
				backgroundColor: ['#a9744e', '#4caf50'],
				borderWidth: 0
			}]
		},
				options: {
					maintainAspectRatio: false,
					cutout: '62%',
					plugins: { legend: { display: true, position: 'bottom' } }
				}
			});
		}

		// Grafico spesa mensile (ultimi 6 mesi)
		const ctxSpending = document.getElementById("cSpending");
		if (ctxSpending && typeof purchases !== 'undefined') {
			const monthsBack = 6;
			const monthLabels = [];
			const monthKeys = [];
			const now = new Date();

			for (let i = monthsBack - 1; i >= 0; i--) {
				const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
				const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
				monthKeys.push(key);
				monthLabels.push(d.toLocaleDateString(localeCode(), { month: 'short', year: '2-digit' }));
			}

			const spendingByMonth = computeMonthlySpending(monthKeys);

			charts.spending = new Chart(ctxSpending, {
				type: 'bar',
				data: {
					labels: monthLabels,
					datasets: [{
						label: t('charts.datasetSpending'),
						data: spendingByMonth,
						backgroundColor: '#f0a02a'
					}]
				},
				options: {
					maintainAspectRatio: false,
					plugins: {
						tooltip: {
							callbacks: {
								label: (ctx) => `€${fmtNum(ctx.parsed.y, 2)}`
							}
						}
					}
				}
			});
		}

		// Grafico ultimi 7 giorni (date locali: toISOString() e' UTC e fra 00:00 e 02:00
		// spostava la finestra a ieri, escludendo le sessioni di oggi)
		const today = todayStr();
		const last7 = [...Array(7)].map((_, i) => shiftDateStr(today, -i)).reverse();
		const weightData = last7.map(d => smokes.filter(s => s.date === d).reduce((acc, curr) => acc + personalGrams(curr), 0));

		const ctxWeight = document.getElementById("cWeight");
		if (ctxWeight) {
			charts.weight = new Chart(ctxWeight, {
				type: 'line',
				data: { 
					labels: last7.map(d => d.slice(8)), 
					datasets: [{
						label: t('charts.datasetGrams'),
						data: weightData,
						borderColor: '#4caf50',
						backgroundColor: 'rgba(76,175,80,0.12)',
						fill: true
					}]
				},
				options: { maintainAspectRatio: false }
			});
		}

		// Grafico completo giornaliero: tutti i giorni dalla prima sessione a oggi, anche quelli
		// a zero (prima la linea saltava i giorni vuoti e univa sessioni lontane settimane).
		const dailyMap = {};
		smokes.forEach(s => { if (!dailyMap[s.date]) dailyMap[s.date] = 0; dailyMap[s.date]++; });
		const sortedDates = [];
		const firstDay = Object.keys(dailyMap).sort()[0];
		if (firstDay) {
			const lastDay = [today, ...Object.keys(dailyMap)].sort().pop();
			for (let d = firstDay; d <= lastDay; d = shiftDateStr(d, 1)) sortedDates.push(d);
		}
		const dailyCounts = sortedDates.map(d => dailyMap[d] || 0);

		const ctxDaily = document.getElementById("cDailyAll");
		if (ctxDaily) {
			charts.dailyAll = new Chart(ctxDaily, {
				type: 'line',
				data: { 
					labels: sortedDates.map(formatShortDate),
					datasets: [{
						label: t('charts.datasetJoints'),
						data: dailyCounts,
						borderColor: '#4caf50',
						backgroundColor: 'rgba(76,175,80,0.12)',
						fill: true
					}]
				},
				options: { maintainAspectRatio: false }
			});
		}

		// Grafico giorni della settimana
		const weekDays = { "Domenica": 0, "Lunedì": 0, "Martedì": 0, "Mercoledì": 0, "Giovedì": 0, "Venerdì": 0, "Sabato": 0 };
		const weekDayNames = Object.keys(weekDays);
		smokes.forEach(s => { weekDays[weekDayNames[weekdayOf(s.date)]]++; });

		const ctxWeek = document.getElementById("cWeekDays");
		if (ctxWeek) {
			charts.week = new Chart(ctxWeek, {
				type: 'bar',
				data: {
					labels: t('common.weekdays'),
					datasets: [{
						label: t('charts.datasetJoints'),
						data: Object.values(weekDays),
						backgroundColor: '#4caf50'
					}]
				},
				options: { maintainAspectRatio: false }
			});
		}

		// Grafico fasce orarie
		const hours = { Notte: 0, Mattina: 0, Pomeriggio: 0, Sera: 0 };
		smokes.forEach(s => { 
			if (!s.time || typeof s.time !== "string") return; 
			const h = parseInt(s.time.split(':')[0]); 
			if (isNaN(h)) return; // orario non valido: prima finiva in "Sera"
			if(h >= 0 && h < 6) hours.Notte++;
			else if(h >= 6 && h < 12) hours.Mattina++;
			else if(h >= 12 && h < 18) hours.Pomeriggio++;
			else hours.Sera++;
		});

		const ctxTime = document.getElementById("cTime");
		if (ctxTime) {
			charts.time = new Chart(ctxTime, {
				type: 'polarArea',
				data: {
					labels: [t('charts.timeSlotNight'), t('charts.timeSlotMorning'), t('charts.timeSlotAfternoon'), t('charts.timeSlotEvening')],
					datasets: [{
						data: Object.values(hours),
						backgroundColor: ['rgba(76,175,80,0.35)', 'rgba(76,175,80,0.55)', 'rgba(76,175,80,0.78)', '#4caf50'],
						borderWidth: 0
					}]
				},
				options: {
					maintainAspectRatio: false,
					plugins: { legend: { display: true, position: 'bottom' } },
					scales: { r: { ticks: { display: false } } }
				}
			});
		}
	}

	function toggleAccordion(el) {
		const content = el.nextElementSibling;
		const isVisible = content.style.display === "block";
		content.style.display = isVisible ? "none" : "block";
		const chevron = el.querySelector('.chevron');
		if (chevron) {
			chevron.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
		}
	}

	async function resetAll() {
		const conferma = confirm(t('settings.resetConfirmQuestion'));

		if (conferma) {
			const confirmWord = t('settings.resetConfirmWord');
			const confermaFinale = prompt(t('settings.resetConfirmPrompt', { word: confirmWord }));

			if (confermaFinale === confirmWord) {
				try {
					if (isGuestMode) {
						setGuestSmokes([]);
					} else {
						const { error } = await supabaseClient
							.from('smokes')
							.delete()
							.eq('user_id', currentUser.id);

						if (error) throw error;
					}

					showMessage(t('settings.resetDone'));
					await loadData();
					showPage('add');
				} catch (err) {
					console.error(err);
					alert(t('settings.resetError'));
				}
			} else {
				alert(t('settings.resetCancelled'));
			}
		}
	}

	// ========== SOCIAL ==========
	function switchSocialTab(tab) {
		currentSocialTab = tab;
		document.getElementById('tab-global').classList.toggle('active', tab === 'global');
		document.getElementById('tab-friends').classList.toggle('active', tab === 'friends');
		document.getElementById('tab-shared').classList.toggle('active', tab === 'shared');
		document.getElementById('sharedPeriodToggle').style.display = tab === 'shared' ? 'flex' : 'none';
		loadSocial();
	}

	function setSharedPeriod(period) {
	sharedPeriod = period;
	document.getElementById('periodMonthBtn').className = period === 'month' ? 'action-btn' : 'secondary-btn';
	document.getElementById('periodAllBtn').className = period === 'all' ? 'action-btn' : 'secondary-btn';
	loadSocial();
}

	// Riga della classifica (redesign 2026, handoff 2g). `rank` è il numero
	// 1-based; il 1° posto è oro, gli altri --sec. `avatarHtml` già pronto,
	// `name` / `sub` già escapati dal chiamante. `badge`: HTML opzionale accanto
	// al nome (fuori dall'ellissi, quindi sempre visibile).
	function lbRow({ rank, avatarHtml, name, sub, score, onclick, isMe, badge }) {
		return `
			<button type="button" class="lb-item${isMe ? ' is-me' : ''}" onclick="${onclick}">
				<span class="lb-rank${rank === 1 ? ' is-first' : ''}">${rank}</span>
				${avatarHtml}
				<span class="lb-name">
					<span class="lb-name-main"><span class="lb-name-text">${name}</span>${badge || ''}</span>
					${sub ? `<span class="lb-name-sub">${sub}</span>` : ''}
				</span>
				<span class="lb-score">${score}</span>
			</button>
		`;
	}

	// ========== TITOLO "LO SCROCCONE" ==========
	// L'amico che mi deve più grammi nelle sessioni condivise (Fumo + Erba, da
	// sempre): stesso saldo della sezione "Insieme" del popup, calcolato dalla
	// RPC get_scroccone. Badge accanto al nickname nei tab Amici / Insieme e nel popup.
	let scroccone = null; // { friend_id, owed } oppure null se nessuno mi deve niente
	let scrocconeLoaded = false;

	async function loadScroccone() {
		if (!currentUser || isGuestMode) return;
		const { data, error } = await supabaseClient.rpc('get_scroccone');
		if (error) { console.error('Errore get_scroccone:', error); return; }
		scroccone = (data && data[0]) || null;
		scrocconeLoaded = true;
	}

	function scrocconeBadge(userId) {
		if (!scroccone || scroccone.friend_id !== userId) return '';
		const hint = t('social.scrocconeHint', { grams: fmtNum(scroccone.owed, 1) });
		return `<span class="scroccone-badge" title="${hint}">${t('social.scrocconeBadge')}</span>`;
	}

	// Card "Il tuo rank" in cima a Social — solo nel tab Mondiale (handoff 2g).
	function renderSocialRank() {
		const card = document.getElementById('socialRankCard');
		if (!card) return;
		if (!lastGlobalRank || currentSocialTab !== 'global') { card.style.display = 'none'; return; }
		const { rank, total } = lastGlobalRank;
		const pct = Math.max(1, Math.round((rank / total) * 100));
		const av = avatarMarkup(currentUserProfile?.avatar_url || null, currentUserProfile?.username || '', 62);
		card.style.display = 'block';
		card.innerHTML = `
			<div class="social-rank-inner">
				${av}
				<div class="social-rank-meta">
					<span class="social-rank-kicker">${t('social.yourRank')}</span>
					<div class="social-rank-num">#${rank}<span>${t('social.rankOf', { total })}</span></div>
					<div class="social-rank-move">${t('social.rankTopPct', { pct })}</div>
				</div>
			</div>
		`;
	}

	async function loadSocial() {
		const list = document.getElementById('leaderboardList');
		if (!list) return;

		renderSocialRank();
		list.innerHTML = '<div class="spinner"></div>';

		if (!currentUser) {
			list.innerHTML = `<p style='text-align:center;'>${t('social.loginToSeeLeaderboard')}</p>`;
			return;
		}

		if (currentSocialTab === 'shared') {
			return loadSharedLeaderboard();
		}

		const isGlobal = currentSocialTab === 'global';
		const rpcName = isGlobal ? 'get_global_leaderboard' : 'get_friends_leaderboard';
		const params = isGlobal ? {} : { current_user_id: currentUser.id };

		try {
			const { data, error } = await supabaseClient.rpc(rpcName, params);

			if (error) {
				console.error("Errore Supabase RPC:", error);
				list.innerHTML = `<p class='error'>${t('social.fetchDataError')}</p>`;
				return;
			}

			if (!data || data.length === 0) {
				list.innerHTML = `<p style='text-align:center; padding: 20px;'>
					${isGlobal ? t('social.noGlobalData') : t('social.noFriendsAddWithNickname')}
				</p>`;
				return;
			}

			if (isGlobal) {
				const myIdx = data.findIndex(u => u.user_id === currentUser.id);
				lastGlobalRank = myIdx >= 0 ? { rank: myIdx + 1, total: data.length } : null;
				renderSocialRank();
			}

			let sharedMap = {};
			if (!isGlobal) {
				const [{ data: sharedData }] = await Promise.all([
					supabaseClient.rpc('get_all_friends_shared_stats'),
					loadScroccone(),
				]);
				if (sharedData) {
					sharedData.forEach(s => { sharedMap[s.friend_id] = s; });
				}
			}

			list.innerHTML = data.map((u, i) => {
				const isMe = u.user_id === currentUser.id;
				const shared = sharedMap[u.user_id];
				const sub = (!isGlobal && shared && shared.sessions_together > 0)
					? t('social.togetherBadge', { count: shared.sessions_together })
					: `${u.total_j} ${t('stats.jointUnit')}`;
				return lbRow({
					rank: i + 1,
					avatarHtml: avatarMarkup(u.avatar_url, u.username, 38),
					name: escapeHtml(u.username) + (isMe ? ` ${t('social.youSuffix')}` : ''),
					sub,
					score: `${fmtNum(u.total_g, 1)}g`,
					onclick: `viewFriendStats('${u.user_id}')`,
					isMe,
					badge: isGlobal ? '' : scrocconeBadge(u.user_id),
				});
			}).join('');

		} catch (err) {
			console.error("Errore generico loadSocial:", err);
			list.innerHTML = `<p class='error'>${t('social.connectionError')}</p>`;
		}
	}

	async function loadSharedLeaderboard() {
		const list = document.getElementById('leaderboardList');

		try {
			const [{ data, error }] = await Promise.all([
				supabaseClient.rpc('get_friends_shared_leaderboard', { period: sharedPeriod }),
				loadScroccone(),
			]);

			if (error) {
				console.error("Errore leaderboard condivise:", error);
				list.innerHTML = `<p class='error'>${t('social.fetchDataError')}</p>`;
				return;
			}

			const filtered = (data || []).filter(u => u.sessions_together > 0);

			if (filtered.length === 0) {
				list.innerHTML = `<p style='text-align:center; padding: 20px;'>
					${sharedPeriod === 'month' ? t('social.noSharedSessionsMonth') : t('social.noSharedSessionsEver')}
				</p>`;
				return;
			}

			list.innerHTML = filtered.map((u, i) => lbRow({
				rank: i + 1,
				avatarHtml: avatarMarkup(u.avatar_url, u.username, 38),
				name: `🤝 ${escapeHtml(u.username)}`,
				sub: t('social.gramsTogetherSuffix', { grams: fmtNum(u.grams_together, 1) }),
				score: String(u.sessions_together),
				onclick: `viewFriendStats('${u.friend_id}')`,
				isMe: false,
				badge: scrocconeBadge(u.friend_id),
			})).join('');

		} catch (err) {
			console.error("Errore generico leaderboard condivise:", err);
			list.innerHTML = `<p class='error'>${t('social.connectionError')}</p>`;
		}
	}

	async function addFriend() {
		const username = document.getElementById('friendUsername').value.trim();
		if (!username) return alert(t('social.enterNickname'));

		const { error } = await supabaseClient.rpc('send_friend_request', { target_username: username });

		if (error) {
			if (error.message && error.message.includes('non trovato')) alert(t('social.userNotFound'));
			else if (error.message && error.message.includes('te stesso')) alert(t('social.cantAddYourself'));
			else if (error.message && error.message.includes('gia')) alert(t('social.requestAlreadySentOrFriends'));
			else alert(t('social.requestSendError'));
		} else {
			showMessage(t('social.requestSent'));
			document.getElementById('friendUsername').value = "";
			if(currentSocialTab === 'friends') loadSocial();
		}
	}

	async function loadFriendRequests() {
		const el = document.getElementById('friendRequestsList');
		if (!el) return;

		const { data, error } = await supabaseClient.rpc('get_pending_friend_requests');
		if (error) { console.error('Errore richieste amicizia:', error); return; }

		if (!data || data.length === 0) {
			el.style.display = 'none';
			el.innerHTML = '';
			return;
		}

		el.style.display = 'block';
		el.innerHTML = `
			<h3 style="margin-top:0;">${t('social.friendRequestsTitle')}</h3>
			${data.map(r => `
				<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(76,175,80,0.08); border-radius:10px; margin-bottom:8px;">
					<span style="font-weight:600; font-size:14px;">👤 ${escapeHtml(r.username)}</span>
					<div style="display:flex; gap:8px;">
						<button class="action-btn" onclick="respondFriendRequest('${r.requester_id}', true)" style="margin-top:0; padding:8px 14px;">${t('social.accept')}</button>
						<button class="secondary-btn" onclick="respondFriendRequest('${r.requester_id}', false)" style="margin-top:0; padding:8px 14px;">${t('social.reject')}</button>
					</div>
				</div>
			`).join('')}
		`;
	}

	async function respondFriendRequest(requesterId, accept) {
		const { error } = await supabaseClient.rpc('respond_friend_request', { requester_id: requesterId, accept });
		if (error) { alert(t('social.respondError')); return; }

		showMessage(accept ? t('social.friendshipAccepted') : t('social.requestRejected'));
		await loadFriendRequests();
		if (currentSocialTab === 'friends') loadSocial();
		if (accept) { await refreshFriendsCount(); await checkAchievements(); }
	}

	let currentModalFriendId = null;
	let currentModalFriendName = '';

	async function viewFriendStats(targetId) {
		const { data, error } = await supabaseClient.rpc('get_friend_stats', { target_user_id: targetId });

		// get_friend_stats risponde 42501 per chi non e' amico (es. aperto dalla classifica mondiale)
		if (error && error.code === '42501') return showMessage(t('social.statsFriendsOnly'));
		if (error || !data || data.length === 0) return alert(t('social.unableToLoadStats'));

		document.getElementById('modaleFumo').innerText = fmtNum(data[0].fumo_g, 1);
		document.getElementById('modaleErba').innerText = fmtNum(data[0].erba_g, 1);
		const uname = (data[0].username) || '';
		document.getElementById('modalFriendName').innerText = uname ? t('social.statsOf', { username: uname }) : t('social.stats');
		const avEl = document.getElementById('modalFriendAvatar');
		if (avEl) avEl.innerHTML = avatarMarkup(data[0].avatar_url, uname, 40);

		currentModalFriendId = targetId;
		currentModalFriendName = uname;
		const removeBtn = document.getElementById('btnRemoveFriendModal');
		if (removeBtn) removeBtn.style.display = (currentSocialTab === 'friends') ? 'block' : 'none';

		document.getElementById('friendModal').style.display = 'flex';

		const badgeEl = document.getElementById('modalFriendBadge');
		if (badgeEl) {
			badgeEl.innerHTML = scrocconeBadge(targetId);
			// popup aperto prima che la classifica amici abbia caricato il titolo
			if (!scrocconeLoaded) {
				loadScroccone().then(() => {
					if (currentModalFriendId === targetId) badgeEl.innerHTML = scrocconeBadge(targetId);
				});
			}
		}

		togetherPeriod = 'all';
		syncTogetherToggle();
		loadFriendTogether();
	}

	// ========== POPUP AMICO: sezione "Insieme" ==========
	// Sessioni condivise tra me e l'amico del popup: totale, contributi (quanto ha
	// PORTATO ciascuno) e saldo, separati per Fumo/Erba. Tutto calcolato dalla RPC
	// get_shared_balance (SECURITY DEFINER, solo amici accettati). Non compare sul
	// proprio profilo ne' se la RPC rifiuta (non amici).
	let togetherPeriod = 'all';
	let togetherReqId = 0;
	let togetherRows = null; // ultimo risultato, per ridisegnare al cambio lingua

	function syncTogetherToggle() {
		document.querySelectorAll('#togetherPeriodToggle button').forEach(b => {
			b.classList.toggle('is-active', b.dataset.period === togetherPeriod);
		});
	}

	document.getElementById('togetherPeriodToggle')?.addEventListener('click', e => {
		const btn = e.target.closest('button[data-period]');
		if (!btn || btn.dataset.period === togetherPeriod) return;
		togetherPeriod = btn.dataset.period;
		syncTogetherToggle();
		loadFriendTogether();
	});

	document.addEventListener('i18n:change', () => {
		const section = document.getElementById('friendTogether');
		if (togetherRows && section && !section.hidden) renderFriendTogether(togetherRows);
	});

	async function loadFriendTogether() {
		const section = document.getElementById('friendTogether');
		const body = document.getElementById('togetherBody');
		if (!section || !body) return;

		const friendId = currentModalFriendId;
		const reqId = ++togetherReqId;
		togetherRows = null;
		if (!friendId || !currentUser || friendId === currentUser.id) {
			section.hidden = true;
			return;
		}

		section.hidden = false;
		body.innerHTML = '<div class="together-loading"><div class="spinner"></div></div>';

		const from = periodStartDate(togetherPeriod);
		const { data, error } = await supabaseClient.rpc('get_shared_balance', {
			p_friend_id: friendId,
			p_since: from ? toDateStr(from) : null,
		});
		if (reqId !== togetherReqId) return; // popup riaperto o periodo cambiato nel frattempo

		if (error) {
			if (error.code !== '42501') console.error('Errore get_shared_balance:', error);
			section.hidden = true;
			return;
		}
		togetherRows = data || [];
		renderFriendTogether(togetherRows);
	}

	function renderFriendTogether(rows) {
		const body = document.getElementById('togetherBody');
		if (!body) return;
		const all = rows.find(r => r.kind === 'all');
		const count = all ? Number(all.sessions) : 0;
		if (!count) {
			body.innerHTML = `<p class="together-empty">${t('social.togetherNone')}</p>`;
			return;
		}
		const name = escapeHtml(currentModalFriendName);
		let html = `<p class="together-count">${tn('social.togetherSessions', count)}</p>`;
		let blocks = 0;
		for (const kind of ['fumo', 'erba']) {
			const r = rows.find(x => x.kind === kind);
			if (r) { html += togetherTypeBlock(kind, r, name); blocks++; }
		}
		// sessioni insieme tutte a 0 g: niente blocchi Fumo/Erba, lo si dice invece di lasciare vuoto
		if (blocks === 0) html += `<p class="together-empty">${t('social.togetherNoGrams')}</p>`;
		body.innerHTML = html;
	}

	// `name` arriva gia' escapato.
	function togetherTypeBlock(kind, r, name) {
		const total = Number(r.total) || 0;
		const mine = Number(r.mine) || 0;
		const theirs = Number(r.theirs) || 0;
		const balance = Number(r.balance) || 0;
		const sum = mine + theirs;
		const pctMine = sum > 0 ? Math.round((mine / sum) * 100) : 0;
		const pctTheirs = sum > 0 ? 100 - pctMine : 0;
		const g = v => fmtNum(v, 1);

		let balanceText, balanceClass;
		if (Math.abs(balance) < 0.05) {
			balanceText = t('social.togetherEven');
			balanceClass = 'is-even';
		} else if (balance > 0) {
			balanceText = t('social.togetherOwesYou', { name, grams: g(balance) });
			balanceClass = 'is-pos';
		} else {
			balanceText = t('social.togetherYouOwe', { name, grams: g(-balance) });
			balanceClass = 'is-neg';
		}

		return `
			<div class="together-type">
				<div class="together-type-head">
					<span class="together-type-name">${t(kind === 'fumo' ? 'social.togetherSmoke' : 'social.togetherWeed')}</span>
					<span class="together-total">${t('social.togetherTotal', { grams: g(total) })}</span>
				</div>
				<p class="together-split">${t('social.togetherSplit', { mine: g(mine), name, theirs: g(theirs) })}</p>
				<div class="together-bar" role="img" aria-label="${t('social.togetherSplitAria', { mine: pctMine, name, theirs: pctTheirs })}">
					<span class="together-bar-mine" style="width:${pctMine}%"></span>
					<span class="together-bar-theirs" style="width:${pctTheirs}%"></span>
				</div>
				<div class="together-bar-legend">
					<span><i class="together-dot together-dot-mine"></i>${t('shared.you')} ${pctMine}%</span>
					<span>${name} ${pctTheirs}%<i class="together-dot together-dot-theirs"></i></span>
				</div>
				<p class="together-balance ${balanceClass}">${balanceText}</p>
			</div>
		`;
	}

	async function removeFriendFromModal() {
		if (!currentModalFriendId) return;
		if (!confirm(t('social.confirmRemoveFriendship'))) return;

		const { error } = await supabaseClient.rpc('remove_friend', { target_id: currentModalFriendId });
		if (error) { alert(t('social.removeFriendshipError')); return; }

		showMessage(t('social.friendshipRemoved'));
		closeFriendModal();
		loadSocial();
		refreshFriendsCount();
	}

	function closeFriendModal() {
		document.getElementById('friendModal').style.display = 'none';
	}

	// ========== PROFILO ==========
	async function updateProfile() {
		const newName = document.getElementById('usernameInput').value.trim();
		if(newName.length < 3) return alert(t('settings.nicknameMinLength'));
		if(/[<>"'`&]/.test(newName)) return alert(t('auth.nicknameNoSpecialChars'));

		const { error } = await supabaseClient
			.from('profiles')
			.upsert({ id: currentUser.id, username: newName });

		if (error) {
			alert(error.code === '23505' ? t('settings.nicknameTaken') : t('settings.profileSaveError'));
		} else {
			showMessage(t('settings.nicknameUpdated'));
			document.getElementById('usernameInput').value = "";
			loadUserProfile();
		}
	}

	async function loadUserProfile() {
		const emailEl = document.getElementById('settingsEmailDisplay');
		if (emailEl) emailEl.textContent = currentUser.email;

		const { data, error } = await supabaseClient
			.from('profiles')
			.select('username, avatar_url')
			.eq('id', currentUser.id)
			.single();

		if (!error && data) {
			currentUserProfile = { username: data.username || null, avatar_url: data.avatar_url || null };
			if (data.username) {
				document.getElementById('currentUsernameDisplay').innerText = data.username;
				document.getElementById('usernameInput').value = data.username;
			}
		}
		renderAvatarSettings();
	}


    async function loadAchievements() {
	// Ordinati per data di sblocco: la Home mostra l'ultimo elemento come "Ultimo traguardo"
	// (senza ORDER BY l'ordine restituito dal DB non era garantito).
	const { data, error } = await supabaseClient
		.from('achievements_unlocked')
		.select('achievement_key')
		.order('unlocked_at', { ascending: true });

	if (!error) {
		unlockedAchievements = (data || []).map(a => a.achievement_key);
	}

	await refreshFriendsCount();

	achievementsLoaded = true;
	await checkAchievements();
	renderAchievements();
}

// Amici ACCETTATI (non le richieste inviate ancora in attesa: sbloccavano "Non Più Solo"
// prima che l'altro accettasse, audit F-05). Richiamata anche dopo accettazione/rimozione.
async function refreshFriendsCount() {
	if (!currentUser || isGuestMode) return;
	const { count, error } = await supabaseClient
		.from('friendships')
		.select('id', { count: 'exact', head: true })
		.eq('user_id', currentUser.id)
		.eq('status', 'accepted');
	if (!error) friendsCountCache = count || 0;
}

async function checkAchievements() {
	for (const ach of ACHIEVEMENTS) {
		if (unlockedAchievements.includes(ach.key)) continue;
		if (ach.check()) {
			unlockedAchievements.push(ach.key);
			if (isGuestMode) {
				try { localStorage.setItem('jt_guest_achievements', JSON.stringify(unlockedAchievements)); } catch (e) {}
			} else {
				await supabaseClient.from('achievements_unlocked').upsert({
					user_id: currentUser.id,
					achievement_key: ach.key
				}, { onConflict: 'user_id,achievement_key' });
			}
			showMessage(t('achievements.unlocked', { title: achTitle(ach.key) }));
		}
	}
	renderAchievements();
}

function renderAchievements() {
	const el = document.getElementById('achievementsList');
	if (!el) return;

	el.innerHTML = ACHIEVEMENTS.map(ach => {
		const unlocked = unlockedAchievements.includes(ach.key);
		return `
			<div style="display:flex; align-items:center; gap:12px; padding:12px; margin-bottom:8px; border-radius:12px;
						background:${unlocked ? 'rgba(76,175,80,0.1)' : 'rgba(var(--overlay-rgb),0.05)'};
						border:1px solid ${unlocked ? 'rgba(76,175,80,0.25)' : 'rgba(var(--overlay-rgb),0.07)'};
						opacity:${unlocked ? '1' : '0.5'};">
				<span style="font-size:28px; filter:${unlocked ? 'none' : 'grayscale(100%)'};">${ach.icon}</span>
				<div>
					<div style="font-weight:700; font-size:14px; color:${unlocked ? 'var(--heading)' : 'var(--color-text-muted)'};">${achTitle(ach.key)}</div>
					<div style="font-size:12px; color:var(--color-text-muted);">${achDesc(ach.key)}</div>
				</div>
			</div>
		`;
	}).join('');
}

async function loadBreaks(skipDetection, depth = 0) {
	if (isGuestMode) return; // tolerance break non disponibile in modalità ospite

	// Rilevamento, chiusura e suggerimento ragionano sulle sessioni: loadBreaks() parte in
	// parallelo a loadData() (showApp) e, se arrivava prima, lavorava su smokes = [].
	await whenSmokesSettled();

	const { data, error } = await supabaseClient
		.from('tolerance_breaks')
		.select('*')
		.order('start_date', { ascending: false });

	if (error) { console.error('Errore caricamento pause:', error); return; }

	allBreaks = data || [];
	activeBreak = allBreaks.find(b => b.is_active) || null;
	pendingBreak = allBreaks.find(b => b.origin === 'planned' && !b.confirmed_at && !b.attempted) || null;

	// depth: al massimo qualche ricarica dopo una scrittura, mai un ciclo se il DB rifiuta.
	if (smokesLoaded && depth < 3) {
		// Sessioni arrivate senza passare da saveData() (sessione condivisa creata da un amico,
		// coda offline, migrazione guest) non chiamavano handleSessionLoggedForBreaks(): la pausa
		// restava "attiva" per sempre pur avendo fumato (audit F-02). La pausa attiva inizia per
		// costruzione il giorno dopo l'ultima sessione, quindi ogni sessione con data >= inizio
		// e' una ripresa: si chiude alla prima di esse.
		if (activeBreak) {
			const relapse = firstSessionOnOrAfter(activeBreak.start_date);
			if (relapse) {
				const result = await closeOrDiscardBreak(activeBreak, relapse);
				if (!result.error) { await loadBreaks(skipDetection, depth + 1); return; }
			}
		} else if (pendingBreak) {
			// Pausa pianificata: conta solo una sessione dal giorno DOPO il tasto "Inizia" (una
			// dello stesso giorno puo' essere stata fumata prima di premerlo).
			const plannedStart = pendingBreak.planned_start_date || pendingBreak.start_date;
			const relapse = firstSessionOnOrAfter(shiftDateStr(plannedStart, 1));
			if (relapse) {
				const { error: attErr } = await supabaseClient
					.from('tolerance_breaks')
					.update({ attempted: true, end_date: relapse })
					.eq('id', pendingBreak.id);
				if (!attErr) { await loadBreaks(skipDetection, depth + 1); return; }
			}
		}

		if (!skipDetection) {
			const changed = await runBreakDetection();
			if (changed) { await loadBreaks(true, depth + 1); return; }
		}
	}

	renderBreakCard();
	renderHomeBreakState();
	if (!smokesLoaded) return; // niente notifiche/suggerimenti calcolati su dati mancanti
	if (activeBreak) {
		await checkBreakNotifications(activeBreak);
	} else if (!pendingBreak) {
		await checkBreakSuggestion();
	}
}

// Prima data di sessione >= dateStr, o null.
function firstSessionOnOrAfter(dateStr) {
	let first = null;
	for (const s of smokes) {
		if (s.date >= dateStr && (first === null || s.date < first)) first = s.date;
	}
	return first;
}

// ========== TOLERANCE BREAK: soglia scalata e retrodatazione (single source of truth) ==========

// Ultima sessione registrata (qualunque data), o null. Si basa solo sulle sessioni
// registrate in "smokes", non sugli acquisti in Scorte: comprare non implica consumare.
function getLastSessionDate() {
	if (smokes.length === 0) return null;
	return smokes.reduce((max, s) => (s.date > max ? s.date : max), smokes[0].date);
}

// Regola unica di retrodatazione (spec §2), usata sia dal rilevamento automatico che dalla
// conferma di una pausa pianificata: la pausa è iniziata il giorno dopo l'ultima sessione
// REALE, non quando l'utente/sistema se ne accorge.
function computeRetroactiveStartDate(fallbackDateStr) {
	const last = getLastSessionDate();
	return last ? shiftDateStr(last, 1) : fallbackDateStr;
}

// Livello di consumo pre-pausa (spec §1, tabella soglie).
function classifyPreBreakLevel(jointsPerDay) {
	if (jointsPerDay < 1) return 'light';
	if (jointsPerDay <= 3) return 'moderate';
	return 'heavy';
}

// Soglia minima di giorni senza sessioni per classificare un gap come tolerance break,
// scalata sul consumo medio pre-pausa (media J/day sui 30gg precedenti l'ultima sessione,
// stesso metodo di getPeriodAverage()/"Real Averages" — riuso, nessuna duplicazione).
// Range da letteratura: Hirvonen et al. 2012, Molecular Psychiatry (recupero recettori CB1
// avviato entro 48h, significativo entro 7gg, quasi completo entro ~28gg in fumatori
// cronici quotidiani); D'Souza et al. 2016, Biological Psychiatry: CNNI (conferma il
// pattern di recupero rapido nei primi giorni). Letteratura di settore indica tempi di
// recupero percepito più lunghi (3-4 settimane) per utilizzatori pesanti quotidiani
// rispetto ai moderati (1-2 settimane). Nota informativa, non un consiglio medico.
function getBreakThresholdDays(jointsPerDay) {
	const level = classifyPreBreakLevel(jointsPerDay);
	if (level === 'light') return 3;
	if (level === 'moderate') return jointsPerDay <= 2 ? 4 : 5;
	if (jointsPerDay <= 5) return 5;
	if (jointsPerDay <= 7) return 6;
	return 7;
}

// Soglia applicabile a una pausa che inizia il giorno "startDateStr": stesso calcolo del
// rilevamento (media J/day sui 30gg precedenti), riusato anche per decidere a posteriori se
// una pausa già chiusa era abbastanza lunga da contare davvero (vedi handleSessionLoggedForBreaks/
// endBreak più sotto).
function getBreakThresholdForBreakStart(startDateStr) {
	const windowEnd = shiftDateStr(startDateStr, -1);
	const windowStart = shiftDateStr(windowEnd, -29);
	return getBreakThresholdDays(getPeriodAverage(windowStart, windowEnd).jointsPerDay);
}

// Confronta lo stato attuale (activeBreak/pendingBreak) con l'ultima sessione registrata e,
// se il gap supera la soglia scalata, crea o conferma una pausa nel DB. Ritorna true se ha
// scritto qualcosa (il chiamante deve ricaricare allBreaks). Unico punto che decide se un
// gap è una vera tolerance break, sia per il rilevamento automatico (spec §1) sia per la
// conferma di una pausa pianificata (spec §4) — stessa regola in entrambi i flussi.
async function runBreakDetection() {
	if (activeBreak) return false; // già una pausa attiva, niente da rilevare

	const lastSession = getLastSessionDate();
	if (!lastSession) return false;

	const todayStr = toDateStr(new Date());
	const gapDays = daysBetween(lastSession, todayStr);
	const threshold = getBreakThresholdForBreakStart(shiftDateStr(lastSession, 1));

	if (gapDays < threshold) return false;

	if (pendingBreak) {
		const { error } = await supabaseClient
			.from('tolerance_breaks')
			.update({
				is_active: true,
				confirmed_at: new Date().toISOString(),
				start_date: computeRetroactiveStartDate(pendingBreak.planned_start_date || todayStr)
			})
			.eq('id', pendingBreak.id);
		return !error;
	}

	const { error } = await supabaseClient.from('tolerance_breaks').insert({
		user_id: currentUser.id,
		start_date: computeRetroactiveStartDate(todayStr),
		origin: 'auto',
		is_active: true,
		confirmed_at: new Date().toISOString()
	});
	return !error;
}

// Chiude una pausa attiva o interrompe un tentativo pianificato non ancora confermato quando
// l'utente registra una nuova sessione (spec §5 e seconda metà di §4). "date" è la data della
// sessione appena salvata (l'utente può inserire sessioni retroattive, non è sempre oggi).
//
// Caso particolare: una sessione dimenticata e aggiunta in ritardo (con data retroattiva) può
// "riempire" il buco che aveva fatto scattare il rilevamento automatico, lasciando una pausa
// chiusa quasi subito dopo essere iniziata (es. 0 giorni) — un falso positivo dovuto solo al
// ritardo con cui è stata segnata, non a una pausa vera. Se la durata finale risulta sotto la
// stessa soglia che l'avrebbe fatta scattare (getBreakThresholdForBreakStart), la eliminiamo
// invece di lasciarla come voce fantasma nello storico.
async function handleSessionLoggedForBreaks(date) {
	if (activeBreak) {
		// Una sessione retroattiva precedente all'inizio della pausa non la interrompe: prima la
		// durata risultava 0, la pausa veniva cancellata e subito ricreata dal rilevamento, con
		// i milestone rinotificati e le modifiche manuali perse (audit F-11).
		if (date < activeBreak.start_date) return;
		const result = await closeOrDiscardBreak(activeBreak, date);
		if (result.discarded && !result.error) showMessage(t('breaks.discardedTooShort'));
	} else if (pendingBreak) {
		if (date < (pendingBreak.planned_start_date || pendingBreak.start_date)) return;
		await supabaseClient
			.from('tolerance_breaks')
			.update({ attempted: true, end_date: date })
			.eq('id', pendingBreak.id);
	} else {
		return;
	}
	await loadBreaks();
}

// Chiude una pausa attiva sulla data "endDate": se la durata risultante è sotto la soglia
// che l'avrebbe qualificata come pausa vera (falso positivo, tipicamente una sessione
// dimenticata e aggiunta in ritardo — vedi sopra), la elimina invece di salvarla. Usata sia
// dalla chiusura automatica su nuova sessione sia dal tasto manuale "Interrompi pausa".
async function closeOrDiscardBreak(brk, endDate) {
	const durationDays = breakDurationDays({ start_date: brk.start_date, end_date: endDate });
	const threshold = getBreakThresholdForBreakStart(brk.start_date);

	if (durationDays < threshold) {
		const { error } = await supabaseClient.from('tolerance_breaks').delete().eq('id', brk.id);
		return { discarded: true, error };
	}
	const { error } = await supabaseClient.from('tolerance_breaks').update({ is_active: false, end_date: endDate }).eq('id', brk.id);
	return { discarded: false, error };
}

function getAvgPricePerGram() {
	if (typeof purchases === 'undefined') return null;
	const priced = purchases.filter(p => p.price && p.grams);
	if (priced.length === 0) return null;
	const totalPrice = priced.reduce((s, p) => s + parseFloat(p.price), 0);
	const totalGrams = priced.reduce((s, p) => s + parseFloat(p.grams), 0);
	return totalGrams > 0 ? totalPrice / totalGrams : null;
}

function getAvgDailyGramsBeforeBreak(breakStartDate) {
	const before = smokes.filter(s => s.date < breakStartDate && !s.not_mine);
	if (before.length === 0) return 0;
	const totalGrams = before.reduce((sum, x) => sum + personalGrams(x), 0);
	const firstDate = before.reduce((min, x) => (x.date < min ? x.date : min), before[0].date);
	const diffDays = Math.max(1, daysBetween(firstDate, breakStartDate));
	return totalGrams / diffDays;
}

// ========== CONFRONTO PRIMA/DOPO PAUSA ==========

// Finestra di confronto per una pausa conclusa: pari alla durata della pausa,
// clampata tra 7 e 30 giorni. Stessa finestra usata sia per "prima" che per "dopo",
// per rendere il confronto simmetrico.
function getBreakComparisonWindowDays(startDate, endDate) {
	const durationDays = Math.max(1, daysBetween(startDate, endDate));
	return Math.min(30, Math.max(7, durationDays));
}

// Aritmetica su date "YYYY-MM-DD" in UTC puro: indipendente dal fuso del dispositivo (prima
// new Date(str) + setDate() + toDateStr() sbagliava di un giorno nei fusi a ovest di UTC).
function shiftDateStr(dateStr, deltaDays) {
	return new Date(Date.parse(dateStr + 'T00:00:00Z') + deltaDays * 86400000).toISOString().slice(0, 10);
}

function getEarliestSmokeDate() {
	if (smokes.length === 0) return null;
	return smokes.reduce((min, s) => (s.date < min ? s.date : min), smokes[0].date);
}

// Media giornaliera (grammi e sessioni/"J") su un periodo fisso [startStr, endStr],
// estremi inclusi, dividendo sempre per il numero totale di giorni del periodo — zero
// incluso per i giorni senza sessioni registrate. Stesso metodo della card "Real Averages".
function getPeriodAverage(startStr, endStr) {
	const inRange = smokes.filter(s => !s.not_mine && s.date >= startStr && s.date <= endStr);
	const totalGrams = inRange.reduce((sum, x) => sum + personalGrams(x), 0);
	const totalDays = daysBetween(startStr, endStr) + 1;
	return {
		gramsPerDay: totalGrams / totalDays,
		jointsPerDay: inRange.length / totalDays
	};
}

function pctChange(before, after) {
	if (before <= 0) return null;
	return ((after - before) / before) * 100;
}

// Confronto prima/dopo per una tolerance break conclusa. Ritorna uno stato 'pending'
// se la finestra "dopo" non è ancora trascorsa per intero, 'insufficient_before' se
// non c'è abbastanza storico prima della pausa, altrimenti 'ready' con le medie.
function getBreakComparison(brk) {
	if (brk.attempted || !brk.end_date) return null;

	const windowDays = getBreakComparisonWindowDays(brk.start_date, brk.end_date);
	const beforeEnd = shiftDateStr(brk.start_date, -1);
	const beforeStart = shiftDateStr(brk.start_date, -windowDays);
	// La finestra "dopo" parte dal giorno di fine pausa (end_date = giorno della ripresa):
	// prima partiva dal giorno dopo, quel giorno non contava in nessuna delle due finestre e
	// una pausa di 10 giorni mostrava "Torna tra 11 giorni" (audit F-13).
	const afterStart = brk.end_date;
	const afterEnd = shiftDateStr(brk.end_date, windowDays - 1);

	const todayStr = toDateStr(new Date());
	if (todayStr <= afterEnd) {
		const daysRemaining = daysBetween(todayStr, afterEnd) + 1;
		return { status: 'pending', daysRemaining };
	}

	const earliest = getEarliestSmokeDate();
	if (!earliest || earliest > beforeStart) {
		return { status: 'insufficient_before' };
	}

	const before = getPeriodAverage(beforeStart, beforeEnd);
	const after = getPeriodAverage(afterStart, afterEnd);

	return {
		status: 'ready',
		windowDays,
		before,
		after,
		gramsChangePct: pctChange(before.gramsPerDay, after.gramsPerDay),
		jointsChangePct: pctChange(before.jointsPerDay, after.jointsPerDay)
	};
}

function renderBreakComparisonHtml(brk) {
	const cmp = getBreakComparison(brk);
	if (!cmp) return '';

	if (cmp.status === 'pending') {
		return `<div style="margin-top:6px; font-size:12px; color:var(--color-text-muted); text-align:center;">${tn('breaks.comparisonPending', cmp.daysRemaining, { days: cmp.daysRemaining })}</div>`;
	}
	if (cmp.status === 'insufficient_before') {
		return `<div style="margin-top:6px; font-size:12px; color:var(--color-text-muted); text-align:center;">${t('breaks.comparisonInsufficientData')}</div>`;
	}

	function pctBadge(pct) {
		if (pct === null) return '';
		const isSame = Math.abs(pct) < 0.5;
		const isUp = pct > 0;
		const color = isSame ? 'var(--color-text-muted)' : (isUp ? '#FF9800' : '#2196F3');
		const arrow = isSame ? '→' : (isUp ? '▲' : '▼');
		return `<span style="color:${color}; font-weight:600;">${arrow} ${fmtNum(Math.abs(pct), 0)}%</span>`;
	}

	const { before, after, gramsChangePct, jointsChangePct } = cmp;

	return `
		<div style="margin-top:8px; padding:10px; border-radius:10px; background:rgba(var(--overlay-rgb),0.05); font-size:12px;">
			<div style="display:flex; justify-content:space-between; color:var(--color-text-muted); margin-bottom:6px;">
				<span>${t('breaks.comparisonBefore')}</span>
				<span>${tn('breaks.comparisonWindowDays', cmp.windowDays, { days: cmp.windowDays })}</span>
				<span>${t('breaks.comparisonAfter')}</span>
			</div>
			<div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:6px; font-weight:700; font-size:14px;">
				<span style="text-align:left;">${fmtNum(before.gramsPerDay, 2)}${t('breaks.comparisonGramsPerDay')}</span>
				<span style="text-align:center; font-size:12px;">${pctBadge(gramsChangePct)}</span>
				<span style="text-align:right;">${fmtNum(after.gramsPerDay, 2)}${t('breaks.comparisonGramsPerDay')}</span>
			</div>
			<div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:6px; margin-top:4px; color:var(--color-text-secondary);">
				<span style="text-align:left;">${fmtNum(before.jointsPerDay, 2)}${t('breaks.comparisonJointsPerDay')}</span>
				<span style="text-align:center; font-size:12px;">${pctBadge(jointsChangePct)}</span>
				<span style="text-align:right;">${fmtNum(after.jointsPerDay, 2)}${t('breaks.comparisonJointsPerDay')}</span>
			</div>
		</div>
	`;
}

function renderBreakCard() {
	const el = document.getElementById('breakCard');
	if (!el) return;

	if (activeBreak) {
		// Redesign 2026 (handoff 2f): hero pausa con anello 170px. Il progresso
		// dell'anello segue lo stesso modello a traguardi scientifici della Home.
		el.className = 'card goals-break-hero';
		const days = breakDaysElapsed(activeBreak);

		const avgDaily = getAvgDailyGramsBeforeBreak(activeBreak.start_date);
		const pricePerGram = getAvgPricePerGram();
		const savedGrams = avgDaily * days;
		const savedMoney = pricePerGram ? (savedGrams * pricePerGram) : null;

		const nextMilestone = BREAK_MILESTONES.find(m => m > days);
		const prevMilestone = [...BREAK_MILESTONES].reverse().find(m => m <= days);
		const anchor = prevMilestone || 0;
		const pct = nextMilestone
			? Math.min(100, Math.round(((days - anchor) / (nextMilestone - anchor)) * 100))
			: 100;
		const micro = prevMilestone ? t(`breaks.milestone${prevMilestone}Short`) : t('breaks.homeJustStarted');
		const toGo = nextMilestone ? (nextMilestone - days) : null;

		el.innerHTML = `
			<p class="goals-break-kicker">${t('breaks.goalsKicker')}</p>
			<div class="goals-break-ring">
				<svg viewBox="0 0 170 170" aria-hidden="true">
					<circle class="goals-break-ring-track" cx="85" cy="85" r="52"></circle>
					<circle class="goals-break-ring-fill" id="goalsBreakRing" cx="85" cy="85" r="52" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"></circle>
				</svg>
				<div class="goals-break-ring-label">
					<b>${days}</b>
					<small>${t('breaks.homeDaysShort')}</small>
				</div>
			</div>
			<p class="goals-break-micro">${micro}</p>
			<div class="goals-break-tiles">
				<div class="goals-break-tile"><b>${savedMoney !== null ? '€' + fmtNum(savedMoney, 0) : '–'}</b><small>${t('breaks.tileSaved')}</small></div>
				<div class="goals-break-tile"><b>${fmtNum(savedGrams, 1)}g</b><small>${t('breaks.tileGrams')}</small></div>
				<div class="goals-break-tile"><b>${toGo !== null ? toGo : '✓'}</b><small>${t('breaks.tileToGo')}</small></div>
			</div>
			<button class="secondary-btn goals-break-slip" onclick="showPage('add')">${t('breaks.homeLogSession')}</button>
			<button type="button" class="goals-break-end" onclick="endBreak()">${t('breaks.endBreak')}</button>
		`;
		const ring = document.getElementById('goalsBreakRing');
		if (ring) requestAnimationFrame(() => { ring.style.strokeDashoffset = String(100 - pct); });
	} else if (pendingBreak) {
		el.className = 'card';
		el.innerHTML = `
			<h3>${t('stats.breakTolerance')}</h3>
			<div style="text-align:center; padding:10px;">
				<div style="font-size:28px;">💤</div>
				<p style="font-size:13px; color:var(--color-text-secondary); margin:8px 0 4px;">${t('breaks.pendingExplain')}</p>
				<button class="secondary-btn" onclick="cancelPendingBreak()" style="margin-top:10px;">${t('breaks.cancelPending')}</button>
			</div>
		`;
	} else {
		el.className = 'card';
		el.innerHTML = `
			<h3>${t('stats.breakTolerance')}</h3>
			<p style="text-align:center; color:var(--color-text-muted); font-size:13px; margin-bottom:10px;">${t('breaks.noActiveBreak')}</p>
			<button class="main-btn" onclick="startBreak()" style="margin-top:0;">${t('breaks.startBreak')}</button>
		`;
	}

	renderBreakHistory();
}

function renderBreakHistory() {
	const el = document.getElementById('breakHistory');
	if (!el) return;

	const past = allBreaks.filter(b => !b.is_active && b.id !== (pendingBreak && pendingBreak.id));
	if (past.length === 0) { el.className = ''; el.innerHTML = ''; return; }

	el.className = 'card';
	el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">${t('breaks.previousBreaks')}</p>` +
		past.map(b => {
			if (b.attempted) {
				return `<div style="padding:8px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); font-size:13px; color:var(--color-text-muted);">
					<div style="display:flex; justify-content:space-between;">
						<span>${t('breaks.attemptedLabel')}</span>
						<span>${formatShortDate(b.planned_start_date || b.start_date)} → ${formatShortDate(b.end_date)}</span>
					</div>
				</div>`;
			}
			const days = breakDurationDays(b);
			return `<div style="padding:8px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); font-size:13px;">
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<span>${formatShortDate(b.start_date)} <a href="javascript:void(0)" onclick="editBreakStartDate(${b.id})" title="${t('breaks.editStartDate')}" style="opacity:0.55; text-decoration:none;">✏️</a> → ${formatShortDate(b.end_date)}</span>
					<span style="font-weight:600; color:var(--primary);">${tn('breaks.durationDays', days, { days })}</span>
				</div>
				${renderBreakComparisonHtml(b)}
			</div>`;
		}).join('');
}

async function editBreakStartDate(breakId) {
	const brk = allBreaks.find(b => b.id === breakId);
	if (!brk) return;

	const input = prompt(t('breaks.editStartDatePrompt'), brk.start_date);
	if (!input) return;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) { alert(t('breaks.editStartDateInvalid')); return; }

	const { error } = await supabaseClient
		.from('tolerance_breaks')
		.update({ start_date: input, manually_edited: true })
		.eq('id', breakId);

	if (error) { alert(t('breaks.editStartDateError')); return; }
	showMessage(t('breaks.editStartDateSaved'));
	await loadBreaks();
}

// Formatta una data locale come YYYY-MM-DD usando i componenti locali (getFullYear/getMonth/getDate),
// evitando toISOString() che converte in UTC e può far slittare il giorno di uno per i fusi orari > UTC.
function toDateStr(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeStr() {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const HEATMAP_COLORS = ['#a5d6a7', '#4caf50', '#2e7d32', '#1b5e20'];

function renderCalendarHeatmap() {
	const el = document.getElementById('calendarHeatmap');
	if (!el) return;

	const counts = {};
	smokes.forEach(s => { counts[s.date] = (counts[s.date] || 0) + 1; });

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = new Date(today);
	start.setDate(start.getDate() - 364);
	start.setDate(start.getDate() - start.getDay()); // allinea a domenica

	const monthNames = t('common.monthsShort');
	const weeks = [];
	const cursor = new Date(start);
	while (cursor <= today) {
		const week = [];
		for (let d = 0; d < 7; d++) {
			if (cursor > today) {
				week.push(null);
			} else {
				const dateStr = toDateStr(cursor);
				week.push({ date: dateStr, month: cursor.getMonth(), count: counts[dateStr] || 0 });
			}
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push(week);
	}

	// Scala dei colori basata solo sui giorni davvero visibili nella griglia (ultimi 12 mesi),
	// non su tutto lo storico: un singolo giorno fuori finestra con tante sessioni sbiadiva
	// tutta la heatmap visibile facendola sembrare piatta.
	const visibleCounts = weeks.flat().filter(Boolean).map(d => d.count);
	const maxCount = Math.max(1, ...visibleCounts);

	function colorFor(count) {
		if (count === 0) return 'rgba(var(--overlay-rgb),0.08)';
		const ratio = count / maxCount;
		if (ratio > 0.75) return HEATMAP_COLORS[3];
		if (ratio > 0.5) return HEATMAP_COLORS[2];
		if (ratio > 0.25) return HEATMAP_COLORS[1];
		return HEATMAP_COLORS[0];
	}

	let lastMonth = null;
	const labelsHtml = weeks.map(week => {
		const firstValid = week.find(d => d);
		let label = '';
		if (firstValid && firstValid.month !== lastMonth) {
			label = monthNames[firstValid.month];
			lastMonth = firstValid.month;
		}
		// flex:0 0 11px (non solo width) evita che il testo del mese forzi la colonna ad
		// allargarsi e disallinei le colonne successive rispetto alla griglia dei giorni sotto.
		return `<div style="flex:0 0 11px; width:11px; overflow:visible; font-size:9px; color:var(--color-text-muted); white-space:nowrap;">${label}</div>`;
	}).join('');

	const gridHtml = weeks.map(week => `
		<div style="display:flex; flex:0 0 11px; flex-direction:column; gap:3px;">
			${week.map(d => d
				? `<div title="${tn('charts.heatmapTooltip', d.count, { date: formatShortDate(d.date) })}" style="width:11px; height:11px; border-radius:2px; background:${colorFor(d.count)};"></div>`
				: `<div style="width:11px; height:11px;"></div>`
			).join('')}
		</div>
	`).join('');

	el.innerHTML = `
		<div style="display:flex; gap:3px; margin-bottom:4px;">${labelsHtml}</div>
		<div style="display:flex; gap:3px;">${gridHtml}</div>
	`;

	const legend = document.getElementById('heatmapLegend');
	if (legend) {
		legend.innerHTML = ['rgba(var(--overlay-rgb),0.08)', ...HEATMAP_COLORS].map(c =>
			`<span style="width:11px; height:11px; border-radius:2px; background:${c}; display:inline-block;"></span>`
		).join('');
	}
}

// ========== OBIETTIVI PERSONALI ==========
let activeGoal = null;

async function loadGoal() {
	const { data, error } = await supabaseClient
		.from('user_goals')
		.select('*')
		.eq('is_active', true)
		.maybeSingle();

	if (error) { console.error('Errore caricamento obiettivo:', error); return; }
	activeGoal = data || null;
	renderGoalCard();
}

function getWeekStart(d) {
	const date = new Date(d);
	const day = date.getDay();
	const diff = (day === 0 ? -6 : 1) - day; // porta a lunedì
	date.setDate(date.getDate() + diff);
	date.setHours(0, 0, 0, 0);
	return date;
}

function renderGoalCard() {
	const el = document.getElementById('goalCard');
	if (!el) return;

	if (!activeGoal) {
		el.innerHTML = `
			<p style="text-align:center; color:var(--color-text-muted); font-size:13px; margin-bottom:10px;">${t('goals.noGoalSet')}</p>
			<select id="goalMetric" style="margin-top:0;">
				<option value="sessions">${t('goals.metricSessions')}</option>
				<option value="grams">${t('goals.metricGrams')}</option>
			</select>
			<select id="goalPeriod" style="margin-top:10px;">
				<option value="week">${t('goals.periodWeek')}</option>
				<option value="month">${t('goals.periodMonth')}</option>
			</select>
			<input type="number" id="goalTarget" min="0.1" step="0.1" placeholder="${t('goals.targetPlaceholder')}" style="margin-top:10px;">
			<button class="main-btn" onclick="setGoal()" style="margin-top:10px;">${t('goals.setGoal')}</button>
		`;
		return;
	}

	const now = new Date();
	let periodStart, periodLabel;
	if (activeGoal.period === 'week') {
		periodStart = getWeekStart(now);
		periodLabel = t('goals.periodThisWeek');
	} else {
		periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
		periodLabel = t('goals.periodThisMonth');
	}
	const periodStartStr = toDateStr(periodStart);

	const today = toDateStr(now);
	const periodSmokes = smokes.filter(s => s.date >= periodStartStr && s.date <= today && !s.not_mine);
	const isSessions = activeGoal.metric === 'sessions';
	const current = isSessions
		? periodSmokes.length
		: periodSmokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const target = parseFloat(activeGoal.target_value);

	const pct = Math.min(100, (current / target) * 100);
	const isOver = current > target;
	const barColor = isOver ? '#f44336' : pct > 75 ? '#FF9800' : '#4CAF50';
	const unit = isSessions ? '' : 'g';
	const metricLabel = isSessions ? t('goals.metricLabelSessions') : t('goals.metricLabelGrams');
	const decimals = isSessions ? 0 : 1;

	el.innerHTML = `
		<div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
			<span style="font-size:13px; color:var(--color-text-secondary);">${metricLabel} ${periodLabel}</span>
			<span style="font-weight:700; color:${barColor};">${fmtNum(current, decimals)}${unit} / ${fmtNum(target, decimals)}${unit}</span>
		</div>
		<div style="background:rgba(var(--overlay-rgb),0.12); border-radius:8px; height:10px; overflow:hidden;">
			<div style="height:100%; width:100%; background:${barColor}; border-radius:8px; transition: transform 0.5s ease; transform:scaleX(${pct / 100}); transform-origin:left;"></div>
		</div>
		${isOver ? `<p style="font-size:12px; color:var(--danger); margin-top:8px; text-align:center;">${t('goals.goalExceeded', { period: periodLabel })}</p>` : ''}
		<button class="secondary-btn" onclick="removeGoal()" style="margin-top:12px;">${t('goals.removeGoal')}</button>
	`;
}

async function setGoal() {
	const metric = document.getElementById('goalMetric').value;
	const period = document.getElementById('goalPeriod').value;
	const target = parseFloat(document.getElementById('goalTarget').value);
	if (!target || target <= 0) return alert(t('goals.enterValidValue'));

	if (activeGoal) {
		await supabaseClient.from('user_goals').update({ is_active: false }).eq('id', activeGoal.id);
	}

	const { error } = await supabaseClient.from('user_goals').insert({
		user_id: currentUser.id,
		metric, period,
		target_value: target,
		is_active: true
	});

	if (error) { alert(t('goals.goalSaveError')); return; }
	showMessage(t('goals.goalSet'));
	await loadGoal();
}

async function removeGoal() {
	if (!activeGoal) return;
	if (!confirm(t('goals.confirmRemoveGoal'))) return;

	const { error } = await supabaseClient.from('user_goals').update({ is_active: false }).eq('id', activeGoal.id);
	if (error) { alert(t('common.removeError')); return; }

	activeGoal = null;
	showMessage(t('goals.goalRemoved'));
	renderGoalCard();
}

function getMonthKey(date) {
	// Da una stringa "YYYY-MM-DD" il mese si legge direttamente (new Date(str) sarebbe la
	// mezzanotte UTC); da un oggetto Date si usano i componenti locali.
	if (typeof date === 'string') return date.slice(0, 7);
	return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

// Mese in corso fino a oggi contro lo STESSO intervallo del mese precedente (giorni 1..N, con
// N limitato alla lunghezza del mese precedente). Confrontare il mese parziale con il mese
// scorso intero dava sempre un calo: -90% il 3 del mese a consumo costante (audit F-08).
function monthToDateComparison() {
	const today = todayStr();
	const [y, m, d] = today.split('-').map(Number);
	const curStart = today.slice(0, 8) + '01';
	const prevStart = toDateStr(new Date(y, m - 2, 1));
	const day = Math.min(d, new Date(y, m - 1, 0).getDate());
	const prevEnd = prevStart.slice(0, 8) + String(day).padStart(2, '0');
	return {
		day,
		cur: smokes.filter(s => s.date >= curStart && s.date <= today),
		prev: smokes.filter(s => s.date >= prevStart && s.date <= prevEnd),
	};
}

// ========== RIEPILOGO ANNUALE ("WRAPPED") ==========
function openWrapped(year) {
	const years = [...new Set(smokes.map(s => Number(s.date.slice(0, 4))))].sort((a, b) => b - a);
	if (years.length === 0) return alert(t('wrapped.noData'));
	const targetYear = year || years[0];
	renderWrapped(targetYear, years);
	document.getElementById('wrappedModal').style.display = 'flex';
}

function closeWrapped() {
	document.getElementById('wrappedModal').style.display = 'none';
}

function renderWrapped(year, years) {
	const yearSmokes = smokes.filter(s => Number(s.date.slice(0, 4)) === year);
	document.getElementById('wrappedTitle').textContent = t('wrapped.title', { year });

	const selector = years.length > 1 ? `
		<select onchange="openWrapped(parseInt(this.value))" style="margin-top:0; margin-bottom:15px;">
			${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
		</select>
	` : '';

	if (yearSmokes.length === 0) {
		document.getElementById('wrappedContent').innerHTML = `${selector}<p style="text-align:center; color:var(--color-text-muted);">${t('wrapped.noDataForYear', { year })}</p>`;
		return;
	}

	const totalGrams = yearSmokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const totalSessions = yearSmokes.length;
	const uniqueDays = new Set(yearSmokes.map(s => s.date)).size;

	const dayNames = t('common.weekdays');
	const dayCounts = [0, 0, 0, 0, 0, 0, 0];
	yearSmokes.forEach(s => dayCounts[weekdayOf(s.date)]++);
	const topDayIdx = dayCounts.indexOf(Math.max(...dayCounts));

	const placeCounts = {};
	yearSmokes.forEach(s => { if (s.location_name) placeCounts[s.location_name] = (placeCounts[s.location_name] || 0) + 1; });
	const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];

	const monthNames = t('common.months');
	const monthCounts = Array(12).fill(0);
	yearSmokes.forEach(s => monthCounts[Number(s.date.slice(5, 7)) - 1]++);
	const topMonthIdx = monthCounts.indexOf(Math.max(...monthCounts));

	const sharedCount = yearSmokes.filter(s => Array.isArray(s.shared_with) && s.shared_with.length > 0).length;

	const yearPurchases = purchases.filter(p => p.date && Number(p.date.slice(0, 4)) === year && p.price);
	const totalSpent = yearPurchases.reduce((sum, p) => sum + parseFloat(p.price), 0);

	document.getElementById('wrappedContent').innerHTML = `
		${selector}
		<div class="stat-grid" style="margin-bottom:15px;">
			<div class="stat-box"><big>${totalSessions}</big><small>${t('wrapped.statSessions')}</small></div>
			<div class="stat-box"><big>${fmtNum(totalGrams, 1)}</big><small>${t('wrapped.statGrams')}</small></div>
			<div class="stat-box"><big>${uniqueDays}</big><small>${t('wrapped.statActiveDays')}</small></div>
			<div class="stat-box"><big>${sharedCount}</big><small>${t('wrapped.statShared')}</small></div>
		</div>
		<div style="font-size:13px; line-height:2;">
			<div>${t('wrapped.favoriteDay', { day: `<strong>${dayNames[topDayIdx]}</strong>` })}</div>
			<div>${tn('wrapped.mostActiveMonth', monthCounts[topMonthIdx], { month: `<strong>${monthNames[topMonthIdx]}</strong>` })}</div>
			${topPlace ? `<div>${t('wrapped.favoritePlace', { place: `<strong>${escapeHtml(topPlace[0])}</strong>`, count: topPlace[1] })}</div>` : ''}
			${totalSpent > 0 ? `<div>${t('wrapped.totalSpent', { amount: `<strong>${fmtNum(totalSpent, 2)}</strong>` })}</div>` : ''}
		</div>
	`;
}

// ========== INSIGHT AUTOMATICI ==========
function renderInsights() {
	const el = document.getElementById('insightsList');
	if (!el) return;

	if (smokes.length < 5) {
		el.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('insights.needMoreData')}</p>`;
		return;
	}

	const insights = [];
	const dayNames = t('common.weekdays');
	const dayCounts = [0, 0, 0, 0, 0, 0, 0];
	const hourSlots = { Notte: 0, Mattina: 0, Pomeriggio: 0, Sera: 0 };
	const placeCounts = {};

	smokes.forEach(s => {
		dayCounts[weekdayOf(s.date)]++;
		if (s.time && typeof s.time === 'string') {
			const h = parseInt(s.time.split(':')[0]);
			if (isNaN(h)) {
				// orario non valido: non finisce in nessuna fascia
			} else if (h >= 0 && h < 6) hourSlots.Notte++;
			else if (h < 12) hourSlots.Mattina++;
			else if (h < 18) hourSlots.Pomeriggio++;
			else hourSlots.Sera++;
		}
		if (s.location_name) placeCounts[s.location_name] = (placeCounts[s.location_name] || 0) + 1;
	});

	const topDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
	if (dayCounts[topDayIdx] > 0) {
		const pct = Math.round((dayCounts[topDayIdx] / smokes.length) * 100);
		insights.push(t('insights.topDay', { day: dayNames[topDayIdx], pct }));
	}

	const topSlot = Object.entries(hourSlots).sort((a, b) => b[1] - a[1])[0];
	if (topSlot && topSlot[1] > 0) {
		const pct = Math.round((topSlot[1] / smokes.length) * 100);
		const slotLabel = { Notte: t('insights.slotNight'), Mattina: t('insights.slotMorning'), Pomeriggio: t('insights.slotAfternoon'), Sera: t('insights.slotEvening') }[topSlot[0]];
		insights.push(t('insights.topSlot', { slot: slotLabel, pct }));
	}

	const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];
	if (topPlace) {
		// location_name puo' arrivare da un amico (sessioni condivise): escape prima di innerHTML
		insights.push(tn('insights.topPlace', topPlace[1], { place: escapeHtml(topPlace[0]) }));
	}

	// Stesso periodo del mese scorso (giorni 1..N), non il mese scorso intero
	const mtd = monthToDateComparison();
	if (mtd.prev.length > 0) {
		const diffPct = Math.round(((mtd.cur.length - mtd.prev.length) / mtd.prev.length) * 100);
		if (Math.abs(diffPct) >= 10) {
			insights.push(diffPct > 0
				? t('insights.moreThisMonth', { pct: diffPct })
				: t('insights.lessThisMonth', { pct: Math.abs(diffPct) }));
		}
	}

	const totalGrams = smokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const avgPerSession = totalGrams / smokes.length;
	insights.push(t('insights.avgPerSession', { grams: fmtNum(avgPerSession, 2) }));

	el.innerHTML = insights.map(i => `
		<div style="padding:10px 12px; margin-bottom:8px; border-radius:10px; background:rgba(var(--overlay-rgb),0.05); font-size:13px; line-height:1.5;">${i}</div>
	`).join('');
}

// ========== CONTESTO & UMORE ==========
// Le etichette vivono già in locales/*.json come label dei radio button nella pagina Aggiungi
// (add.contextRelax ecc.) - qui le si riusa invece di duplicarle in un secondo oggetto.
const CONTEXT_TAG_KEYS = { relax: 'add.contextRelax', social: 'add.contextSocial', creativo: 'add.contextCreative', sonno: 'add.contextSleep' };
function contextTagLabel(tag) { return CONTEXT_TAG_KEYS[tag] ? t(CONTEXT_TAG_KEYS[tag]) : tag; }

function renderContextStats() {
	const el = document.getElementById('contextStatsList');
	if (!el) return;

	const tagged = smokes.filter(s => s.context_tag);
	if (tagged.length === 0) {
		el.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('context.noTaggedYet')}</p>`;
		return;
	}

	const grouped = {};
	tagged.forEach(s => {
		if (!grouped[s.context_tag]) grouped[s.context_tag] = { count: 0, moodSum: 0, moodCount: 0 };
		grouped[s.context_tag].count++;
		if (s.mood_rating) {
			grouped[s.context_tag].moodSum += s.mood_rating;
			grouped[s.context_tag].moodCount++;
		}
	});

	el.innerHTML = Object.entries(grouped).sort((a, b) => b[1].count - a[1].count).map(([tag, data]) => {
		const avgMood = data.moodCount > 0 ? fmtNum(data.moodSum / data.moodCount, 1) : null;
		return `
			<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(var(--overlay-rgb),0.05); border-radius:10px; margin-bottom:6px;">
				<span style="font-size:13px; font-weight:600;">${escapeHtml(contextTagLabel(tag))}</span>
				<span style="font-size:12px; color:var(--color-text-muted);">${tn('context.sessionsLabel', data.count)}${avgMood ? t('context.avgMoodSuffix', { avg: avgMood }) : ''}</span>
			</div>
		`;
	}).join('');
}

function renderPeriodComparison() {
	const el = document.getElementById('periodComparison');
	if (!el) return;

	// Mese in corso fino a oggi contro gli stessi giorni del mese scorso (audit F-08)
	const mtd = monthToDateComparison();
	const currentCount = mtd.cur.length;
	const lastCount = mtd.prev.length;
	const currentGrams = mtd.cur.reduce((sum, s) => sum + personalGrams(s), 0);
	const lastGrams = mtd.prev.reduce((sum, s) => sum + personalGrams(s), 0);

	function renderDiff(current, last) {
		if (last === 0 && current === 0) return `<span style="color:var(--color-text-muted); font-size:12px;">${t('period.noData')}</span>`;
		if (last === 0) return `<span style="color:var(--primary); font-size:12px; font-weight:600;">${t('period.newThisMonth')}</span>`;
		const pct = ((current - last) / last) * 100;
		const isSame = Math.abs(pct) < 0.5;
		const isUp = pct > 0;
		const color = isSame ? 'var(--color-text-muted)' : (isUp ? '#FF9800' : '#2196F3');
		const arrow = isSame ? '→' : (isUp ? '▲' : '▼');
		return `<span style="color:${color}; font-size:12px; font-weight:600;">${arrow} ${fmtNum(Math.abs(pct), 0)}%</span>`;
	}

	function renderRow(label, current, last, suffix) {
		const displayVal = suffix === 'g' ? fmtNum(current, 1) : fmtNum(current, 0);
		return `
			<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06);">
				<span style="font-size:13px; color:var(--color-text-secondary);">${label}</span>
				<div style="text-align:right;">
					<div style="font-weight:700; font-size:15px;">${displayVal}${suffix}</div>
					${renderDiff(current, last)}
				</div>
			</div>
		`;
	}

	el.innerHTML = `
		${renderRow(t('period.sessions'), currentCount, lastCount, '')}
		${renderRow(t('period.totalGrams'), currentGrams, lastGrams, 'g')}
		<p style="font-size:11px; color:var(--color-text-muted); margin-top:8px; text-align:center;">${tn('period.lastMonthSummary', lastCount, { day: mtd.day, grams: fmtNum(lastGrams, 1) })}</p>
	`;
}

// Il tasto "Inizia una pausa": psicologicamente identico a prima (l'utente ha la sensazione
// di iniziare subito), ma sotto il cofano crea una pausa "pianificata" (spec §4) che si
// conferma da sola con data retrodatata solo se il gap senza sessioni supera la soglia
// scalata (vedi runBreakDetection). Se logghi una sessione prima che scatti, resta nello
// storico come tentativo non completato invece di sparire.
async function startBreak() {
	const today = toDateStr(new Date());
	const { error } = await supabaseClient.from('tolerance_breaks').insert({
		user_id: currentUser.id,
		start_date: today,
		planned_start_date: today,
		origin: 'planned',
		is_active: false
	});

	if (error) { alert(t('breaks.startBreakError')); return; }
	showMessage(t('breaks.breakStarted'));
	await loadBreaks();
}

async function cancelPendingBreak() {
	if (!pendingBreak) return;
	if (!confirm(t('breaks.confirmCancelPending'))) return;

	const { error } = await supabaseClient.from('tolerance_breaks').delete().eq('id', pendingBreak.id);
	if (error) { alert(t('breaks.cancelPendingError')); return; }
	showMessage(t('breaks.pendingCancelled'));
	await loadBreaks();
}

async function endBreak() {
	if (!activeBreak) return;
	if (!confirm(t('breaks.confirmEndBreak'))) return;

	const today = toDateStr(new Date());
	const result = await closeOrDiscardBreak(activeBreak, today);

	if (result.error) { alert(t('breaks.endBreakError')); return; }
	showMessage(result.discarded ? t('breaks.discardedTooShort') : t('breaks.breakEnded'));
	await loadBreaks();
}

// ========== PROMEMORIA (banner in-app) ==========
function checkReminderBanner() {
	const banner = document.getElementById('reminderBanner');
	const textEl = document.getElementById('reminderBannerText');
	if (!banner || !textEl) return;

	if (sessionStorage.getItem('reminderDismissed') === 'today') {
		banner.style.display = 'none';
		return;
	}

	const today = todayStr(); // data locale: toISOString() e' UTC e fra 00:00 e 02:00 era ieri
	const hasToday = smokes.some(s => s.date === today);

	if (hasToday) {
		banner.style.display = 'none';
		return;
	}

	const streak = calculateStreak();
	if (streak >= 1) {
		textEl.textContent = t('reminder.streakRisk', { streak });
	} else {
		textEl.textContent = t('reminder.nothingLoggedToday');
	}
	banner.style.display = 'block';
}

function dismissReminderBanner() {
	sessionStorage.setItem('reminderDismissed', 'today');
	document.getElementById('reminderBanner').style.display = 'none';
}

// ========== NOTIFICHE IN-APP ==========
async function loadNotifications() {
	const { data, error } = await supabaseClient
		.from('notifications')
		.select('*')
		.order('updated_at', { ascending: false })
		.limit(30);

	if (error) { console.error('Errore notifiche:', error); return; }

	notifications = data || [];
	renderNotifications();
	updateNotifBadge();
}

function notifText(n) {
	if (n.type === 'snapshot_reaction') return tn('notif.snapshotReactions', n.event_count || 1);
	if (n.type === 'snapshot_comment') return tn('notif.snapshotComments', n.event_count || 1);
	// Notifiche salvate come chiave i18n + parametri: tradotte nella lingua attiva invece di
	// restare nella lingua in cui erano state create. "message" resta come fallback (righe
	// vecchie o chiave sconosciuta).
	if (n.msg_key) {
		const params = n.msg_params || {};
		const txt = t(n.msg_key, params);
		if (typeof txt === 'string' && txt !== n.msg_key) {
			return params.disclaimer ? `${txt} ${t('breaks.milestoneDisclaimer')}` : txt;
		}
	}
	return n.message || '';
}

function goToSnapshot(snapshotId) {
	const panel = document.getElementById('notifPanel');
	if (panel) panel.classList.remove('active');
	showPage('social');
	setTimeout(() => {
		const idx = feedItems.findIndex(it => it.id === snapshotId);
		if (idx >= 0) {
			const card = document.querySelector(`#snapshotFeed .feed-card[data-index="${idx}"]`);
			if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}, 400);
}

function renderNotifications() {
	const list = document.getElementById('notifList');
	if (!list) return;

	if (notifications.length === 0) {
		list.innerHTML = `<p style="padding:15px; text-align:center; color:var(--color-text-muted); font-size:13px;">${t('reminder.noNotifications')}</p>`;
		return;
	}

	list.innerHTML = notifications.map(n => `
		<div class="notif-row${n.snapshot_id ? ' notif-clickable' : ''}"${n.snapshot_id ? ` data-snapshot-id="${n.snapshot_id}"` : ''} style="padding:12px 15px; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); background:${n.read ? 'transparent' : 'rgba(76,175,80,0.08)'};">
			<p style="margin:0; font-size:13px; color:var(--color-text);">${escapeHtml(notifText(n))}</p>
			<small style="color:var(--color-text-muted);">${formatNotifTime(n.updated_at || n.created_at)}</small>
		</div>
	`).join('');

	if (!renderNotifications._bound) {
		renderNotifications._bound = true;
		list.addEventListener('click', (e) => {
			const row = e.target.closest('.notif-clickable');
			if (!row) return;
			goToSnapshot(Number(row.dataset.snapshotId));
		});
	}
}

function formatNotifTime(iso) {
	const d = new Date(iso);
	const now = new Date();
	const diffMin = Math.floor((now - d) / 60000);
	if (diffMin < 1) return t('reminder.justNow');
	if (diffMin < 60) return t('reminder.minutesAgo', { count: diffMin });
	const diffH = Math.floor(diffMin / 60);
	if (diffH < 24) return t('reminder.hoursAgo', { count: diffH });
	return d.toLocaleDateString(localeCode());
}

function updateNotifBadge() {
	const badge = document.getElementById('notifBadge');
	if (!badge) return;
	const unread = notifications.filter(n => !n.read).length;
	if (unread > 0) {
		badge.textContent = unread > 9 ? '9+' : unread;
		badge.style.display = 'flex';
	} else {
		badge.style.display = 'none';
	}
}

async function toggleNotifications(ev) {
	// Evita che il click che apre il pannello risalga fino al listener
	// "chiudi se clicchi fuori" (che scatterebbe subito, es. dalla riga
	// "Notifiche" nella pagina Altro — non è #notifBtn quindi non è esclusa).
	if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();

	const panel = document.getElementById('notifPanel');

	const isOpening = !panel.classList.contains('active');
	panel.classList.toggle('active');

	if (isOpening) {
		// In modalità ospite loadNotifications() non gira mai: senza questo il
		// pannello si aprirebbe vuoto invece di mostrare "Nessuna notifica".
		renderNotifications();
		await markAllNotificationsRead();
	}
}

async function markAllNotificationsRead() {
	const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
	if (unreadIds.length === 0) return;

	notifications.forEach(n => n.read = true);
	renderNotifications();
	updateNotifBadge();

	await supabaseClient.from('notifications').update({ read: true }).in('id', unreadIds);
}

function subscribeToNotifications() {
	supabaseClient
		.channel('notifications-channel')
		.on('postgres_changes', {
			event: 'INSERT',
			schema: 'public',
			table: 'notifications',
			filter: `user_id=eq.${currentUser.id}`
		}, (payload) => {
			notifications.unshift(payload.new);
			renderNotifications();
			updateNotifBadge();
			showMessage('🔔 ' + notifText(payload.new));
		})
		.on('postgres_changes', {
			event: 'UPDATE',
			schema: 'public',
			table: 'notifications',
			filter: `user_id=eq.${currentUser.id}`
		}, (payload) => {
			const i = notifications.findIndex(x => x.id === payload.new.id);
			// echo di markAllNotificationsRead: bulk update read=true su righe già lette localmente.
			// Rimpiazzo la riga ma salto il re-render per non ripaginare N volte su un click.
			if (i >= 0 && payload.new.read === true && notifications[i].read === true) {
				notifications[i] = payload.new;
				return;
			}
			if (i >= 0) notifications[i] = payload.new;
			else notifications.unshift(payload.new);
			notifications.sort((a, b) =>
				new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
			renderNotifications();
			updateNotifBadge();
		})
		.subscribe();
}

// ========== IMPOSTAZIONI PROMEMORIA ==========
async function loadReminderSettings() {
	const { data } = await supabaseClient
		.from('profiles')
		.select('reminder_enabled, reminder_time')
		.eq('id', currentUser.id)
		.single();

	if (data) {
		userReminderSettings = data;
		document.getElementById('reminderEnabledCheck').checked = data.reminder_enabled;
		if (data.reminder_time) {
			document.getElementById('reminderTimeInput').value = data.reminder_time.slice(0, 5);
		}
	}
}

async function saveReminderSettings() {
	const enabled = document.getElementById('reminderEnabledCheck').checked;
	const time = document.getElementById('reminderTimeInput').value;

	const { error } = await supabaseClient
		.from('profiles')
		.update({ reminder_enabled: enabled, reminder_time: time })
		.eq('id', currentUser.id);

	if (error) {
		alert(t('settings.saveReminderError'));
	} else {
		showMessage(t('settings.preferencesSaved'));
	}
}

// ========== NOTIFICHE PUSH ==========
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}

async function enablePushNotifications() {
	const statusEl = document.getElementById('pushStatus');

	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		statusEl.textContent = t('settings.pushNotSupported');
		return;
	}

	try {
		statusEl.textContent = t('settings.pushActivating');

		const registration = await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;

		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			statusEl.textContent = t('settings.pushPermissionDenied');
			return;
		}

		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
		});

		const subJson = subscription.toJSON();

		const { error } = await supabaseClient.from('push_subscriptions').upsert({
			user_id: currentUser.id,
			endpoint: subJson.endpoint,
			p256dh: subJson.keys.p256dh,
			auth: subJson.keys.auth
		}, { onConflict: 'endpoint' });

		if (error) {
			statusEl.textContent = t('settings.pushSubscriptionSaveError');
			console.error(error);
			return;
		}

		statusEl.textContent = t('settings.pushActivated');
		loadPushDevices();
	} catch (err) {
		console.error(err);
		statusEl.textContent = t('settings.pushActivationError');
	}
}

// ========== STATO BACKUP AUTOMATICI (solo metadati, mai il contenuto) ==========
async function loadBackupStatus() {
	const el = document.getElementById('backupStatusList');
	if (!el) return;
	el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">${t('common.loading')}</p>`;

	try {
		const { data, error } = await supabaseClient.functions.invoke('list-backups');
		if (error || !data?.ok) throw error || new Error('Risposta non valida');

		if (!data.files || data.files.length === 0) {
			el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">${t('settings.noBackupsYet')}</p>`;
			return;
		}

		el.innerHTML = data.files.slice(0, 5).map(f => `
			<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); font-size:12px;">
				<span>${f.name}</span>
				<span style="color:var(--color-text-muted);">${new Date(f.created_at).toLocaleDateString(localeCode())}</span>
			</div>
		`).join('');
	} catch (err) {
		console.error('Errore stato backup:', err);
		el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">${t('settings.backupStatusError')}</p>`;
	}
}

// ========== GESTIONE DISPOSITIVI PUSH ==========
async function getCurrentPushEndpoint() {
	try {
		if (!('serviceWorker' in navigator)) return null;
		const reg = await navigator.serviceWorker.getRegistration();
		if (!reg) return null;
		const sub = await reg.pushManager.getSubscription();
		return sub ? sub.endpoint : null;
	} catch (e) {
		return null;
	}
}

async function loadPushDevices() {
	const { data, error } = await supabaseClient
		.from('push_subscriptions')
		.select('id, endpoint, created_at')
		.order('created_at', { ascending: false });

	if (error) { console.error('Errore caricamento dispositivi push:', error); return; }
	await renderPushDevices(data || []);
}

async function renderPushDevices(devices) {
	const el = document.getElementById('pushDevicesList');
	if (!el) return;

	if (devices.length === 0) {
		el.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('settings.noPushDevices')}</p>`;
		return;
	}

	const currentEndpoint = await getCurrentPushEndpoint();

	el.innerHTML = devices.map(d => {
		const isThis = d.endpoint === currentEndpoint;
		const dateStr = new Date(d.created_at).toLocaleDateString(localeCode());
		return `
			<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(var(--overlay-rgb),0.05); border-radius:10px; margin-bottom:6px;">
				<div>
					<span style="font-size:13px; font-weight:600;">${t('settings.deviceLabel')}${isThis ? ` <span style="color:var(--primary); font-size:11px;">${t('settings.thisDeviceSuffix')}</span>` : ''}</span><br>
					<small style="color:var(--color-text-muted);">${t('settings.activatedOn', { date: dateStr })}</small>
				</div>
				<button onclick="revokePushDevice(${d.id})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">🗑️</button>
			</div>
		`;
	}).join('');
}

async function revokePushDevice(id) {
	if (!confirm(t('settings.confirmRevokeDevice'))) return;
	const { error } = await supabaseClient.from('push_subscriptions').delete().eq('id', id);
	if (error) { alert(t('common.removeError')); return; }
	showMessage(t('settings.deviceRemoved'));
	loadPushDevices();
}


		// ========== SCORTE / ACQUISTI ==========
let purchases = [];
let activeFumoStock = null;
let activeErbaStock = null;
let currentBuyType = null;
let pendingCloseStock = null; // scorta in attesa di chiusura (usato dai modal)
let sessionsToFix = []; // sessioni del periodo da correggere

async function loadPurchases() {
    if (isGuestMode) {
        purchases = getGuestPurchases().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        activeFumoStock = purchases.find(p => p.type === 'fumo' && !p.is_closed) || null;
        activeErbaStock = purchases.find(p => p.type === 'erba' && !p.is_closed) || null;
        renderStockPage();
        renderMiniWidget();
        return;
    }
    const { data, error } = await supabaseClient
        .from('purchases')
        .select('*')
        .order('date', { ascending: false });

    if (error) {
        console.error('Errore caricamento acquisti:', error);
        const cached = getLocalCache('purchases');
        if (cached) {
            purchases = cached;
            activeFumoStock = purchases.find(p => p.type === 'fumo' && !p.is_closed) || null;
            activeErbaStock = purchases.find(p => p.type === 'erba' && !p.is_closed) || null;
            renderStockPage();
            renderMiniWidget();
        }
        return;
    }

    purchases = data || [];
    cacheLocalData('purchases', purchases);
    activeFumoStock = purchases.find(p => p.type === 'fumo' && !p.is_closed) || null;
    activeErbaStock = purchases.find(p => p.type === 'erba' && !p.is_closed) || null;

    renderStockPage();
    renderMiniWidget();
}

// ========== CALCOLO GRAMMI CONSUMATI DA UNA DATA ==========
// Calcola i grammi consumati tra due date (esclude sessioni "non mia")
function gramsConsumedSince(type, sinceDate, untilDate = null) {
    return smokes
        .filter(s => {
            if (s.not_mine) return false; // escludi sessioni non tue
            if (s.date < sinceDate) return false;
            if (untilDate && s.date > untilDate) return false;
            return true;
        })
        .reduce((sum, s) => sum + (type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0)), 0);
}

// Dato un tipo, restituisce lista acquisti aperti ordinati dal più vecchio (FIFO)
function getOpenPurchasesFIFO(type) {
    return purchases
        .filter(p => p.type === type && !p.is_closed)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Calcola i grammi consumati per uno specifico acquisto (FIFO)
// Scala dal più vecchio: il consumo del 2° parte solo dopo che il 1° è esaurito
function gramsConsumedForPurchase(purchase) {
    const type = purchase.type;
    const openFIFO = getOpenPurchasesFIFO(type);
    const idx = openFIFO.findIndex(p => p.id === purchase.id);
    if (idx === -1) return 0;

    // Consumo totale dal giorno del primo acquisto aperto
    const oldestDate = openFIFO[0].date;
    const totalConsumed = gramsConsumedSince(type, oldestDate);

    // Somma i grammi degli acquisti più vecchi (quelli prima di questo nella lista FIFO)
    let gramsBeforeThis = 0;
    for (let i = 0; i < idx; i++) {
        gramsBeforeThis += parseFloat(openFIFO[i].grams);
    }

    // Quanto è stato consumato "dentro" questo acquisto
    const consumedIntoThis = Math.max(0, totalConsumed - gramsBeforeThis);
    return Math.min(consumedIntoThis, parseFloat(purchase.grams));
}

// Grammi rimanenti per un acquisto specifico
function gramsRemainingForPurchase(purchase) {
    const consumed = gramsConsumedForPurchase(purchase);
    return Math.max(0, parseFloat(purchase.grams) - consumed);
}

// Quanto era stato consumato di un acquisto specifico, cumulativamente, fino a una certa data
// (stessa logica FIFO di gramsConsumedForPurchase ma "congelata" a una data, e includendo anche
// gli acquisti gia' chiusi: serve a ricostruire quanto e' stato fumato mese per mese, non solo
// lo stato attuale).
function gramsConsumedForPurchaseAsOf(purchase, asOfDate) {
    const type = purchase.type;
    const allOfType = purchases
        .filter(p => p.type === type && p.date <= asOfDate)
        .sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);

    const idx = allOfType.findIndex(p => p.id === purchase.id);
    if (idx === -1) return 0; // l'acquisto non era ancora stato registrato a quella data

    const oldestDate = allOfType[0].date;
    const totalConsumed = gramsConsumedSince(type, oldestDate, asOfDate);

    let gramsBeforeThis = 0;
    for (let i = 0; i < idx; i++) {
        gramsBeforeThis += parseFloat(allOfType[i].grams);
    }

    const consumedIntoThis = Math.max(0, totalConsumed - gramsBeforeThis);
    return Math.min(consumedIntoThis, parseFloat(purchase.grams));
}

// Spesa "reale" per mese: il prezzo di un acquisto viene spalmato sui mesi in cui quella
// scorta e' stata effettivamente fumata (grammi consumati in quel mese * prezzo/grammo),
// non tutto sul mese in cui e' stato comprato.
function computeMonthlySpending(monthKeys) {
    const priced = purchases.filter(p => p.price && p.grams);

    return monthKeys.map(key => {
        const [y, m] = key.split('-').map(Number);
        const monthEnd = toDateStr(new Date(y, m, 0));
        const prevMonthEnd = toDateStr(new Date(y, m - 1, 0));

        return priced.reduce((sum, p) => {
            const upToEnd = gramsConsumedForPurchaseAsOf(p, monthEnd);
            const upToPrev = gramsConsumedForPurchaseAsOf(p, prevMonthEnd);
            const consumedInMonth = Math.max(0, upToEnd - upToPrev);
            const pricePerGram = parseFloat(p.price) / parseFloat(p.grams);
            return sum + consumedInMonth * pricePerGram;
        }, 0);
    });
}

function computeDailyRate(type, daysWindow = 14) {
	// Esattamente daysWindow giorni di calendario, oggi incluso, in data locale (prima: cutoff
	// in UTC e finestra di daysWindow+1 giorni divisa per daysWindow).
	const today = todayStr();
	const cutoffStr = shiftDateStr(today, -(daysWindow - 1));

	const recentGrams = smokes
		.filter(s => !s.not_mine && s.date >= cutoffStr && s.date <= today)
		.reduce((sum, s) => sum + (type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0)), 0);

	return recentGrams / daysWindow;
}

function getTotalRemaining(type) {
	return getOpenPurchasesFIFO(type).reduce((sum, p) => sum + gramsRemainingForPurchase(p), 0);
}

// ========== RENDER PAGINA STOCK ==========
function renderStockPage() {
    if (!smokesLoaded) return; // consumato ancora sconosciuto: evita di mostrare la scorta come piena per errore
    renderStockCard('fumo');
    renderStockCard('erba');
    renderPurchaseHistory();
}



function renderStockCard(type, stock) {
    const emoji = type === 'fumo' ? '🍫' : '🍃';
    const color = type === 'fumo' ? '#795548' : 'var(--heading)';
    const colorLight = type === 'fumo' ? 'rgba(139,69,19,0.1)' : 'rgba(76,175,80,0.1)';
    const displayEl = document.getElementById(`stock${type.charAt(0).toUpperCase()+type.slice(1)}Display`);
    const closeBtn = document.getElementById(`btnClose${type.charAt(0).toUpperCase()+type.slice(1)}`);

    const openPurchases = getOpenPurchasesFIFO(type);
    const card = displayEl.closest('.stock-substance');

    if (openPurchases.length === 0) {
        displayEl.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('stock.noActiveStock')}</p>`;
        if (closeBtn) closeBtn.style.display = 'none';
        if (card) card.classList.remove('stock-substance--filled');
        return;
    }

    // Nascondi il vecchio tasto globale (ora è inline per acquisto)
    if (closeBtn) closeBtn.style.display = 'none';
    if (card) card.classList.add('stock-substance--filled');

    // ---- Redesign 2026 (handoff 2i): hero "Rimanenti" 72px + metriche ----
    const totalRemaining = openPurchases.reduce((s, p) => s + gramsRemainingForPurchase(p), 0);
    const totalOpenGrams = openPurchases.reduce((s, p) => s + parseFloat(p.grams), 0);
    const heroPct = totalOpenGrams > 0 ? Math.min(100, Math.max(0, (totalRemaining / totalOpenGrams) * 100)) : 0;

    const typeSessions = smokes.filter(s => !s.not_mine && (type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0)) > 0);
    const avgPerSession = typeSessions.length
        ? typeSessions.reduce((a, s) => a + (type === 'fumo' ? s.fumo_grams : s.erba_grams), 0) / typeSessions.length
        : 0;
    const sessionsLeft = avgPerSession > 0 ? Math.round(totalRemaining / avgPerSession) : null;

    const dailyRate = computeDailyRate(type);
    let runsOutStr = null;
    if (dailyRate > 0) {
        const daysLeft = Math.round(totalRemaining / dailyRate);
        const d = new Date();
        d.setDate(d.getDate() + daysLeft);
        runsOutStr = d.toLocaleDateString(localeCode(), { day: 'numeric', month: 'short' });
    }

    // Media PESATA (€ totali / grammi totali), la stessa di getAvgPricePerGram usata per i
    // "Risparmiati" della pausa: la media semplice dei €/g dava un altro numero (7,50 vs 5,45).
    const pricedOfType = purchases.filter(p => p.type === type && p.price && p.grams);
    const pricedGrams = pricedOfType.reduce((a, p) => a + parseFloat(p.grams), 0);
    const avgPrice = pricedGrams > 0
        ? pricedOfType.reduce((a, p) => a + parseFloat(p.price), 0) / pricedGrams
        : null;

    let html = `
        <div class="stock-hero">
            <div class="stock-hero-head">
                <span class="stock-hero-kicker">${emoji} ${t('stock.remainingLabel')}</span>
                ${sessionsLeft !== null ? `<span class="stock-hero-sessions">${t('stock.heroSessionsLeft', { n: sessionsLeft })}</span>` : ''}
            </div>
            <div class="stock-hero-value">${fmtNum(totalRemaining, 1)}<span>g</span></div>
            <div class="stock-hero-bar"><div class="stock-hero-bar-fill" style="width:${heroPct}%;"></div></div>
            ${runsOutStr ? `<div class="stock-hero-caption">${t('stock.heroRunsOut', { date: runsOutStr })}</div>` : ''}
        </div>
        <div class="stock-metrics">
            <div class="stock-metric"><b>${avgPrice !== null ? '€' + fmtNum(avgPrice, 2) : '–'}</b><small>${t('stock.metricAvgPrice')}</small></div>
            <div class="stock-metric"><b>${dailyRate > 0 ? fmtNum(dailyRate, 2) + 'g' : '–'}</b><small>${t('stock.metricPace')}</small></div>
        </div>
        <div class="stock-fifo">`;

    openPurchases.forEach((p, idx) => {
        const isOldest = idx === 0;
        const consumed = gramsConsumedForPurchase(p);
        const remaining = gramsRemainingForPurchase(p);
        const pct = Math.min(100, Math.max(0, (remaining / parseFloat(p.grams)) * 100));
        const priceStr = p.price ? ` · €${fmtNum(p.price, 2, 0)}` : '';
        const barColor = pct > 50 ? '#4CAF50' : pct > 20 ? '#FF9800' : '#f44336';

        const oldestLabel = isOldest && openPurchases.length > 1
            ? `<span style="background:var(--warning-bg); color:var(--warning-text); font-size:11px; padding:2px 8px; border-radius:20px; margin-left:6px;">${t('stock.inUseBadge')}</span>`
            : '';

        html += `
            <div style="background:${colorLight}; border-radius:12px; padding:14px; margin-bottom:${idx < openPurchases.length-1 ? '12px' : '0'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:13px; color:var(--color-text-secondary);">
                        ${emoji} ${t('stock.purchaseOfDate', { date: formatShortDate(p.date) })}${oldestLabel}
                    </span>
                    <span style="font-weight:700; color:${color};">${fmtNum(p.grams, 2, 0)}g${priceStr}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:13px; color:var(--color-text-secondary);">${t('stock.consumedLabel')}</span>
                    <span style="font-weight:600; color:var(--color-text-secondary);">${fmtNum(consumed, 2)}g</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:14px; font-weight:700; color:${color};">${t('stock.remainingLabel')}</span>
                    <span style="font-size:18px; font-weight:800; color:${color};">${fmtNum(remaining, 2)}g</span>
                </div>
                <div style="background:rgba(var(--overlay-rgb),0.12); border-radius:8px; height:10px; overflow:hidden;">
                    <div style="height:100%; width:100%; background:${barColor}; border-radius:8px; transition: transform 0.5s ease; transform:scaleX(${pct / 100}); transform-origin:left;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                    <span style="font-size:11px; color:var(--color-text-muted);">${t('stock.percentRemaining', { pct: fmtNum(pct, 0) })}</span>
                    ${isOldest ? `<button onclick="closeStock('${type}', ${p.id})" style="background:none; border:none; color:var(--danger); font-size:12px; font-weight:bold; cursor:pointer; text-decoration:underline; padding:0;">${t('stock.outOfThisStock')}</button>` : ''}
                </div>
            </div>
        `;
    });

    html += `</div>`;
    displayEl.innerHTML = html;

    // barra hero: anima da 0 alla larghezza target al mount
    const heroFill = displayEl.querySelector('.stock-hero-bar-fill');
    if (heroFill) {
        const target = heroFill.style.width;
        heroFill.style.width = '0';
        requestAnimationFrame(() => { heroFill.style.width = target; });
    }
}



// ========== MINI WIDGET PAGINA AGGIUNGI ==========
function renderMiniWidget() {
    const widget = document.getElementById('miniStockWidget');
    if (!widget) return;
    if (!smokesLoaded) return; // consumato ancora sconosciuto: meglio non mostrare nulla che mostrare "piena" per errore
    document.getElementById('homeStockCard')?.classList.remove('is-loading');
    const noStockMsg = document.getElementById('homeNoStock');

    const openFumo = getOpenPurchasesFIFO('fumo');
    const openErba = getOpenPurchasesFIFO('erba');

    if (openFumo.length === 0 && openErba.length === 0) {
        widget.style.display = 'none';
        if (noStockMsg) noStockMsg.style.display = 'block';
        return;
    }

    widget.style.display = 'block';
    if (noStockMsg) noStockMsg.style.display = 'none';

    // Rimanente TOTALE per tipo (somma degli acquisti aperti) e barra su quanto acquistato:
    // mostrare solo l'acquisto piu' vecchio dava "0.00g" anche con altre scorte disponibili.
    let totalRemaining = 0;
    const renderMini = (open, gramsId, barId) => {
        if (open.length === 0) {
            document.getElementById(gramsId).textContent = '–';
            document.getElementById(barId).style.transform = 'scaleX(0)';
            return;
        }
        const remaining = open.reduce((sum, p) => sum + gramsRemainingForPurchase(p), 0);
        const bought = open.reduce((sum, p) => sum + parseFloat(p.grams), 0);
        totalRemaining += remaining;
        const pct = bought > 0 ? Math.min(100, (remaining / bought) * 100) : 0;
        document.getElementById(gramsId).textContent = fmtNum(remaining, 2) + 'g';
        document.getElementById(barId).style.transform = 'scaleX(' + (pct / 100) + ')';
    };
    renderMini(openFumo, 'miniFumoGrams', 'miniFumoBar');
    renderMini(openErba, 'miniErbaGrams', 'miniErbaBar');

    const hintEl = document.getElementById('homeStockHint');
    if (hintEl) hintEl.textContent = t('home.stockTotalLeft', { grams: fmtNum(totalRemaining, 1) });
}

// ========== STORICO ACQUISTI ==========
function renderPurchaseHistory() {
    const el = document.getElementById('purchaseHistory');
    if (!el) return;

    if (purchases.length === 0) {
        el.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">${t('stock.noPurchasesRegistered')}</p>`;
        return;
    }

    el.innerHTML = purchases.map(p => {
        const emoji = p.type === 'fumo' ? '🍫' : '🍃';
        const label = p.type === 'fumo' ? t('charts.labelSmoke') : t('charts.labelWeed');
        const priceStr = p.price ? ` · <span style="color:var(--warning);">€${fmtNum(p.price, 2, 0)}</span>` : '';

        const statusStr = p.is_closed
            ? `<span style="background:rgba(var(--overlay-rgb),0.08); color:var(--color-text-muted); font-size:11px; padding:2px 8px; border-radius:20px;">${t('stock.closedBadge')}</span>`
            : `<span style="background:rgba(76,175,80,0.12); color:var(--primary); font-size:11px; padding:2px 8px; border-radius:20px;">${t('stock.activeBadge')}</span>`;

        let consumedStr = '–';
        let barHtml = '';

        if (!p.is_closed) {
            const consumed = gramsConsumedForPurchase(p);
            const remaining = gramsRemainingForPurchase(p);
            const pct = Math.min(100, Math.max(0, (remaining / parseFloat(p.grams)) * 100));
            const barColor = pct > 50 ? '#4CAF50' : pct > 20 ? '#FF9800' : '#f44336';
            consumedStr = t('stock.consumedRemainingLine', { consumed: fmtNum(consumed, 2), remaining: fmtNum(remaining, 2) });
            barHtml = `
                <div style="background:rgba(var(--overlay-rgb),0.12); border-radius:6px; height:6px; overflow:hidden; margin-top:6px;">
                    <div style="height:100%; width:100%; background:${barColor}; border-radius:6px; transition: transform 0.5s ease; transform:scaleX(${pct / 100}); transform-origin:left;"></div>
                </div>
            `;
        } else if (p.closed_at) {
            const days = Math.max(0, daysBetween(p.date, p.closed_at));
            consumedStr = tn('stock.closedOnDuration', days, { date: formatShortDate(p.closed_at), days });
        }

        return `
            <div style="padding:12px; border-bottom:1px solid rgba(var(--overlay-rgb),0.07);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-weight:700;">${emoji} ${label}</span>
                        ${statusStr}<br>
                        <small style="color:var(--color-text-muted);">${formatShortDate(p.date)} · ${fmtNum(p.grams, 2, 0)}g${priceStr}</small><br>
                        <small style="color:var(--color-text-muted);">${consumedStr}</small>
                    </div>
                    <button onclick="deletePurchase(${p.id})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:18px;">🗑️</button>
                </div>
                ${barHtml}
            </div>
        `;
    }).join('');
}

// ========== MODAL ACQUISTO ==========
function openBuyModal(type) {
    currentBuyType = type;
    document.getElementById('buyModalTitle').textContent =
        t('stock.buyModalTitleFor', { type: type === 'fumo' ? t('add.smoke') : t('add.weed') });
    document.getElementById('buyGrams').value = '';
    document.getElementById('buyPrice').value = '';
    document.getElementById('buyDate').value = todayStr(); // data locale, non UTC
    document.getElementById('buyModal').style.display = 'flex';
}

function closeBuyModal() {
    document.getElementById('buyModal').style.display = 'none';
    currentBuyType = null;
}

async function savePurchase() {
    const grams = parseFloat(document.getElementById('buyGrams').value);
    const price = parseFloat(document.getElementById('buyPrice').value) || null;
    const date = document.getElementById('buyDate').value;

    if (!grams || grams <= 0) return alert(t('stock.enterValidQuantity'));
    if (!date) return alert(t('stock.enterDate'));

    // Se c'è già una scorta attiva dello stesso tipo, chiedi conferma
    const existing = currentBuyType === 'fumo' ? activeFumoStock : activeErbaStock;
    if (existing) {
        const typeLabel = currentBuyType === 'fumo' ? t('stock.typeSmoke') : t('stock.typeWeed');
        if (!confirm(t('stock.confirmAddSeparatePurchase', { type: typeLabel }))) return;
    }

    if (isGuestMode) {
        const guestPurchases = getGuestPurchases();
        guestPurchases.push({ id: genGuestId(), type: currentBuyType, grams, price, date, closed_at: null, is_closed: false });
        setGuestPurchases(guestPurchases);
    } else {
        const { error } = await supabaseClient.from('purchases').insert({
            user_id: currentUser.id,
            type: currentBuyType,
            grams,
            price,
            date,
            is_closed: false
        });

        if (error) { alert(t('stock.saveError')); return; }
    }

    closeBuyModal();
    showMessage(t('stock.purchaseRegistered'));
    await loadPurchases();
}

async function deletePurchase(id) {
    if (!confirm(t('stock.confirmDeletePurchase'))) return;
    if (isGuestMode) {
        setGuestPurchases(getGuestPurchases().filter(p => p.id !== id));
        showMessage(t('stock.purchaseDeleted'));
        await loadPurchases();
        return;
    }
    const { error } = await supabaseClient.from('purchases').delete().eq('id', id);
    if (!error) { showMessage(t('stock.purchaseDeleted')); await loadPurchases(); }
}

// ========== CHIUSURA SCORTA + CONTROLLO DISCREPANZA ==========
function closeStock(type, purchaseId) {
    const stock = purchases.find(p => p.id === purchaseId);
    if (!stock) return;

    const consumed = gramsConsumedForPurchase(stock);
    const diff = consumed - parseFloat(stock.grams);
    const absDiff = Math.abs(diff);
    const threshold = 0.3;

    pendingCloseStock = { type, stock, consumed, diff };

    sessionsToFix = smokes.filter(s => {
        if (s.not_mine) return false;
        const gram = type === 'fumo' ? s.fumo_grams : s.erba_grams;
        return s.date >= stock.date && gram > 0;
    });

    if (absDiff <= threshold) {
        confirmCloseStock();
        return;
    }

    const typeLabel = type === 'fumo' ? t('stock.typeSmoke') : t('stock.typeWeed');
    let msg = '';
    if (diff > 0) {
        msg = t('stock.discrepancyExcess', { consumed: fmtNum(consumed, 2), type: typeLabel, grams: fmtNum(stock.grams, 2, 0), diff: fmtNum(absDiff, 2) });
    } else {
        msg = t('stock.discrepancyShortfall', { consumed: fmtNum(consumed, 2), type: typeLabel, grams: fmtNum(stock.grams, 2, 0), diff: fmtNum(absDiff, 2) });
    }

    document.getElementById('discrepancyText').innerHTML = msg;
    document.getElementById('discrepancyModal').style.display = 'flex';
}

// Annulla: chiude il modal senza chiudere la scorta (niente più "ignora e chiudi comunque")
function closeDiscrepancyModal() {
    document.getElementById('discrepancyModal').style.display = 'none';
    pendingCloseStock = null;
    sessionsToFix = [];
}

// Campi da aggiornare per correggere i grammi di "type" di una sessione da oldGram a newGram.
// Sessione NON condivisa: il consumo personale (my_*) e' lo stesso valore del contributo, quindi
// si corregge anche quello, altrimenti Stats/Home/classifiche restavano sul valore sbagliato.
// Sessione condivisa: my_* e' il totale dell'intera sessione (vedi CLAUDE.md), non si tocca;
// cambia solo il contributo (scorta + saldo "Insieme").
function buildGramsFix(s, type, oldGram, newGram, oldTotal) {
    const newTotal = parseFloat(((Number(oldTotal) || 0) - oldGram + newGram).toFixed(2));
    const upd = type === 'fumo' ? { fumo_grams: newGram, grams: newTotal } : { erba_grams: newGram, grams: newTotal };
    const isShared = Array.isArray(s.shared_with) && s.shared_with.length > 0;
    if (!isShared) {
        const myKey = type === 'fumo' ? 'my_fumo_grams' : 'my_erba_grams';
        const myOld = s[myKey];
        if (myOld === null || myOld === undefined || Math.abs(Number(myOld) - oldGram) < 0.005) upd[myKey] = newGram;
    }
    return upd;
}

// Scala tutte le sessioni proporzionalmente
async function fixProportional() {
    if (!pendingCloseStock) return;
    const { type, stock, consumed } = pendingCloseStock;

    if (consumed === 0) { confirmCloseStock(); return; }

    const factor = stock.grams / consumed; // es. 0.85 se hai segnato troppo

    const guestSmokes = isGuestMode ? getGuestSmokes() : null;
    let failed = 0;

    for (const s of sessionsToFix) {
        const oldGram = type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0);
        const newGram = parseFloat((oldGram * factor).toFixed(2));
        const updateObj = buildGramsFix(s, type, oldGram, newGram, s.grams);

        if (isGuestMode) {
            const rec = guestSmokes.find(g => g.id === s.id);
            if (rec) Object.assign(rec, updateObj);
        } else {
            const { error } = await supabaseClient.from('smokes').update(updateObj).eq('id', s.id);
            if (error) failed++;
        }
    }

    if (isGuestMode) setGuestSmokes(guestSmokes);
    if (failed > 0) { alert(t('stock.saveError')); await loadData(); return; } // la scorta resta aperta

    document.getElementById('discrepancyModal').style.display = 'none';
    showMessage(t('stock.sessionsRecalculated'));
    await loadData();
    confirmCloseStock();
}

// Mostra lista sessioni modificabili manualmente
function fixManual() {
    document.getElementById('discrepancyModal').style.display = 'none';
    const { type, stock } = pendingCloseStock;

    document.getElementById('manualFixHint').textContent =
        t('stock.manualFixHint', { type: type === 'fumo' ? t('stock.typeSmoke') : t('stock.typeWeed'), grams: stock.grams });

    const listEl = document.getElementById('manualFixList');
    listEl.innerHTML = sessionsToFix.map(s => {
        const gram = type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0);
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;
                        padding:10px; border-bottom:1px solid rgba(var(--overlay-rgb),0.07);">
                <div>
                    <span style="font-weight:600;">${formatShortDate(s.date)}</span>
                    <span style="color:var(--color-text-muted); font-size:12px;"> ${s.time}</span><br>
                    <small style="color:var(--color-text-muted);">${t('stock.sessionTotal', { grams: fmtNum(s.grams, 2, 0) })}</small>
                </div>
                <input type="number" step="0.01" min="0"
                       data-id="${s.id}"
                       data-type="${type}"
                       data-total="${s.grams}"
                       data-old="${gram}"
                       value="${gram}"
                       style="width:80px; text-align:center; margin:0; font-weight:700; color:var(--heading);">
            </div>
        `;
    }).join('');

    document.getElementById('manualFixModal').style.display = 'flex';
}

async function saveManualFix() {
    const inputs = document.querySelectorAll('#manualFixList input[data-id]');
    const guestSmokes = isGuestMode ? getGuestSmokes() : null;
    let failed = 0;

    for (const input of inputs) {
        const id = input.dataset.id;
        const type = input.dataset.type;
        const oldTotal = parseFloat(input.dataset.total);
        const oldGram = parseFloat(input.dataset.old);
        const newGram = parseFloat(input.value) || 0;
        const session = smokes.find(s => String(s.id) === String(id)) || {};
        const updateObj = buildGramsFix(session, type, oldGram, newGram, oldTotal);

        if (isGuestMode) {
            const rec = guestSmokes.find(g => g.id === Number(id));
            if (rec) Object.assign(rec, updateObj);
        } else {
            const { error } = await supabaseClient.from('smokes').update(updateObj).eq('id', id);
            if (error) failed++;
        }
    }

    if (isGuestMode) setGuestSmokes(guestSmokes);
    if (failed > 0) { alert(t('stock.saveError')); closeManualFix(); await loadData(); return; } // la scorta resta aperta

    closeManualFix();
    showMessage(t('stock.sessionsFixed'));
    await loadData();
    confirmCloseStock();
}

function closeManualFix() {
    document.getElementById('manualFixModal').style.display = 'none';
}

// Chiusura effettiva della scorta nel DB
async function confirmCloseStock() {
    document.getElementById('discrepancyModal').style.display = 'none';
    if (!pendingCloseStock) return;

    const { stock } = pendingCloseStock;
    const closedAt = todayStr(); // data locale, non UTC

    if (isGuestMode) {
        const guestPurchases = getGuestPurchases();
        const rec = guestPurchases.find(p => p.id === stock.id);
        if (rec) Object.assign(rec, { is_closed: true, closed_at: closedAt });
        setGuestPurchases(guestPurchases);
    } else {
        const { error } = await supabaseClient
            .from('purchases')
            .update({ is_closed: true, closed_at: closedAt })
            .eq('id', stock.id);

        if (error) { alert(t('stock.closeStockError')); return; }
    }

    showMessage(t('stock.stockClosed'));
    pendingCloseStock = null;
    sessionsToFix = [];
    await loadPurchases();
}
		


	// ========== INIZIALIZZAZIONE ==========
	document.getElementById("date").value = toDateStr(new Date());
	document.getElementById("time").value = nowTimeStr();

	document.querySelectorAll('input[name="g"]').forEach(r => {
		r.addEventListener("change", e => {
			document.querySelectorAll(".grams-row label").forEach(l => l.classList.remove("selected"));
			e.target.parentElement.classList.add("selected");
			document.getElementById("customGrams").style.display = e.target.value === "custom" ? "block" : "none";
		});
	});

	// ========== CHIUSURA PANNELLO NOTIFICHE ==========
	// (Il dropdown hamburger #menu è stato sostituito dalla barra inferiore +
	//  pagina "Altro" nel redesign 2026: qui resta solo la logica del pannello
	//  notifiche.)

document.addEventListener('DOMContentLoaded', function() {
	const feedToggle = document.getElementById('snapshotFeedToggle');
	if (feedToggle) feedToggle.addEventListener('click', () => toggleSnapshotFeed());

	// Chiudi le notifiche se clicchi fuori
	document.addEventListener('click', function(event) {
		const notifPanel = document.getElementById('notifPanel');
		const notifBtn = document.getElementById('notifBtn');

		if (notifPanel && notifBtn && !notifPanel.contains(event.target) && !notifBtn.contains(event.target)) {
			notifPanel.classList.remove('active');
		}
	});
});
	

	// ========== SERVICE WORKER: registrazione per il caching offline ==========
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW non registrato:', err));
	}
	updateOnlineStatus();

	initTheme();
	armEntranceAnimations();
	checkAuth();

// ========== PWA INSTALL: bottone custom (Chromium) + istruzioni manuali (iOS) ==========
let deferredInstallPrompt = null;

function isStandaloneMode() {
	return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIOSDevice() {
	return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

// Chrome/Edge/Android: il browser spara questo evento invece di mostrare da solo
// il proprio prompt d'installazione. Lo salviamo per poterlo attivare noi dal bottone custom.
window.addEventListener('beforeinstallprompt', function(e) {
	e.preventDefault();
	deferredInstallPrompt = e;
	updateInstallUI();
});

window.addEventListener('appinstalled', function() {
	deferredInstallPrompt = null;
	updateInstallUI();
});

// Safari/iOS non implementa beforeinstallprompt: se l'app non è già installata,
// mostriamo le istruzioni manuali per "Aggiungi a Home" invece del bottone.
function updateInstallUI() {
	const card = document.getElementById('installAppCard');
	const androidBtn = document.getElementById('installAppBtn');
	const iosHint = document.getElementById('installAppIosHint');
	if (!card || !androidBtn || !iosHint) return;

	if (isStandaloneMode()) {
		card.style.display = 'none';
		return;
	}

	if (deferredInstallPrompt) {
		card.style.display = 'block';
		androidBtn.style.display = 'block';
		iosHint.style.display = 'none';
	} else if (isIOSDevice()) {
		card.style.display = 'block';
		androidBtn.style.display = 'none';
		iosHint.style.display = 'block';
	} else {
		card.style.display = 'none';
	}
}

async function installApp() {
	if (!deferredInstallPrompt) return;
	deferredInstallPrompt.prompt();
	await deferredInstallPrompt.userChoice;
	deferredInstallPrompt = null;
	updateInstallUI();
}

updateInstallUI();