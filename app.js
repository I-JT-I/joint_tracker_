// ========== INIZIALIZZAZIONE SUPABASE ==========
	const SUPABASE_URL = 'https://afkxmbxcavwhurmdelfr.supabase.co';
	const SUPABASE_KEY = 'sb_publishable_1rc0ueZL6Y03qhk5jp_34w_ObCOCpCP';
	const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

	// ========== VARIABILI GLOBALI ==========
	let currentUser = null;
	let smokes = [];
	let currentLocation = { lat: null, lng: null, name: null };
	let mapInstance = null;
	let mapMarkers = [];
	let currentSocialTab = 'global';
	let charts = {};
	let userPlaces = []; // Array per i posti caricati dal DB
	let sessionParticipants = []; // { user_id, username }
	let isLocatingNow = false;
	let isOnline = navigator.onLine;
	let notifications = [];
	let sharedPeriod = 'month';
    let activeBreak = null;
    let allBreaks = [];
	const VAPID_PUBLIC_KEY = 'BE2yG7kWhMrni1qk-uilMqHc7uGL92CZE6UaLt-sbTTHsDr4lDP6qiqnSJsxachx5kUJ7C-0dO46UeSjxOUwiG0';
	let userReminderSettings = { reminder_enabled: true, reminder_time: '20:00:00' };
	let unlockedAchievements = [];
let friendsCountCache = 0;
let achievementsLoaded = false;

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

// Grammi personalmente consumati in una sessione (quota propria per le sessioni condivise,
// non il totale grezzo "grams" che in passato poteva riflettere l'importo di un altro partecipante).
function personalGrams(s) {
	return (s.my_fumo_grams ?? s.fumo_grams ?? 0) + (s.my_erba_grams ?? s.erba_grams ?? 0);
}

// title/desc si leggono da locales/*.json tramite achTitle()/achDesc(), non da qui,
// così restano coerenti se la lingua cambia dopo il primo render.
const ACHIEVEMENTS = [
	{ key: 'first_session', icon: '🌱', check: () => smokes.length >= 1 },
	{ key: 'sessions_10', icon: '🔥', check: () => smokes.length >= 10 },
	{ key: 'sessions_100', icon: '💯', check: () => smokes.length >= 100 },
	{ key: 'sessions_500', icon: '🏆', check: () => smokes.length >= 500 },
	{ key: 'streak_7', icon: '📅', check: () => calculateStreak() >= 7 },
	{ key: 'streak_30', icon: '🗓️', check: () => calculateStreak() >= 30 },
	{ key: 'streak_100', icon: '💎', check: () => calculateStreak() >= 100 },
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
        const fumo = (grams / 2).toFixed(1);
        const erba = (grams / 2).toFixed(1);
        msgDiv.style.display = "block";
        document.getElementById("divideText").textContent = `${fumo}g 🍫 + ${erba}g 🍃`;
    } else {
        msgDiv.style.display = "none";
    }
}

function toggleSharedSession() {
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

    if (error || !friendships || friendships.length === 0) return [];

    const friendIds = friendships.map(f => f.friend_id);

    const { data: profilesData } = await supabaseClient
        .from('profiles_public')
        .select('id, username')
        .in('id', friendIds);

    return profilesData || [];
}

async function renderFriendsQuickList() {
    const el = document.getElementById('friendsQuickList');
    if (!el) return;
    el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted);">${t('common.loading')}</p>`;

    const friends = await getMyFriendsList();

    if (friends.length === 0) {
        el.innerHTML = `<p style="font-size:12px; color:var(--color-text-muted);">${t('shared.noFriendsYet')}</p>`;
        return;
    }

    el.innerHTML = friends.map(f => `
        <button type="button" onclick="quickAddParticipant('${f.id}','${f.username}')"
            style="background:rgba(76,175,80,0.12); border:1px solid rgba(76,175,80,0.3); color:var(--heading); border-radius:20px; padding:6px 12px; font-size:13px; cursor:pointer;">
            + ${f.username}
        </button>
    `).join('');
}

function quickAddParticipant(id, username) {
    if (sessionParticipants.some(p => p.user_id === id)) return;
    sessionParticipants.push({ user_id: id, username });
    renderParticipantChips();
}

async function searchParticipant() {
    const input = document.getElementById('participantSearch');
    const query = input.value.trim();
    if (!query) return;

    const { data, error } = await supabaseClient
        .from('profiles_public')
        .select('id, username')
        .ilike('username', query)
        .neq('id', currentUser.id);

    if (error || !data || data.length === 0) {
        return alert(t('shared.noUserFound'));
    }

    const match = data.find(u => u.username.toLowerCase() === query.toLowerCase()) || data[0];

    if (sessionParticipants.some(p => p.user_id === match.id)) {
        return alert(t('shared.alreadyAdded'));
    }

    sessionParticipants.push({ user_id: match.id, username: match.username });
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
        <span class="participant-chip">👤 ${p.username} <button onclick="removeParticipant('${p.user_id}')">✕</button></span>
    `).join('');
    renderContributorsPanel();
}

function renderContributorsPanel() {
    const panel = document.getElementById('contributorsPanel');
    if (!panel) return;
    if (sessionParticipants.length === 0) { panel.innerHTML = ''; return; }

    const hasFumo = document.getElementById("fumo").checked;
    const hasErba = document.getElementById("erba").checked;
    const all = [{ user_id: currentUser.id, username: t('shared.you') }, ...sessionParticipants];

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
                        onchange="renderContributorsPanel()" style="width:auto;"> ${p.username}
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
                        onchange="renderContributorsPanel()" style="width:auto;"> ${p.username}
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
			showApp();
			await loadData();
		} else {
			showLoginPage();
		}
	}

	function showLoginPage() {
		document.getElementById('page-auth').classList.add('active');
		document.getElementById('header').style.display = 'none';
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
				${t('auth.noAccount')} <a onclick="toggleAuthMode(); return false;" style="cursor: pointer; color: var(--primary-light);" data-signup-link>${t('auth.signupLink')}</a>
			</p>
		`;
	}

	function toggleAuthMode() {
		const content = document.getElementById('authContent');
		if (content.querySelector('[data-signup-link]')) {
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
					${t('auth.haveAccount')} <a onclick="toggleAuthMode(); return false;" style="cursor: pointer; color: var(--primary-light);">${t('auth.loginLink')}</a>
				</p>
			`;
		} else {
			showLoginPage();
		}
	}

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
			currentUser = result.data.user;
			await initI18n();
			showApp();
			await loadData();
			showMessage(t('auth.welcome'));
		} catch (err) {
			showError(err.message);
		}
	}

	async function showApp() {
		document.getElementById('page-auth').classList.remove('active');
		document.getElementById('header').style.display = 'flex';
		showPage('home');
		document.getElementById('emailDisplay').textContent = currentUser.email;
		document.getElementById('date').value = toDateStr(new Date());
		document.getElementById('time').value = nowTimeStr();

		const defaultRadio = document.querySelector('input[name="g"][value="0.3"]');
		if(defaultRadio) {
			defaultRadio.parentElement.classList.add('selected');
		}

		// 🆕 AUTO GEOLOCALIZZAZIONE AL CARICAMENTO
	await loadUserPlaces();
	await loadPurchases();
	await loadReminderSettings();
	await loadNotifications();
	await loadAchievements();
	await loadBreaks();
	await loadGoal();
	subscribeToNotifications();
	getLocationAuto();
	await checkOnboarding();
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
	const pending = getPendingSessions();
	if (pending.length === 0) return;

	showMessage(tn('sync.syncingSessions', pending.length));

	const stillFailed = [];
	for (const payload of pending) {
		const { error } = await supabaseClient.from('smokes').insert(payload);
		if (error) stillFailed.push(payload);
	}

	localStorage.setItem('jt_pending_sessions', JSON.stringify(stillFailed));

	if (stillFailed.length === 0) {
		showMessage(t('sync.allSynced'));
		await loadData();
	} else {
		showMessage(tn('sync.syncFailedRetry', stillFailed.length));
	}
}

	async function logout() {
		await supabaseClient.auth.signOut();
		currentUser = null;
		smokes = [];
		showLoginPage();
	}

	// ========== CARICAMENTO DATI ==========
	async function loadData() {
		const { data, error } = await supabaseClient
			.from('smokes')
			.select('*')
			.order('ts', { ascending: false });

		if (error) {
			console.error('Errore caricamento dati:', error);
			const cached = getLocalCache('smokes');
			if (cached) {
				smokes = cached;
				update();
				showMessage(t('sync.offlineDataStale'));
			}
			return;
		}

		smokes = data || [];
		cacheLocalData('smokes', smokes);
		update();
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
	if (selectedPhotoFile) {
		if (navigator.onLine) {
			photoPath = await uploadSessionPhoto(ts);
			if (!photoPath) showMessage(t('add.photoNotUploaded'));
		} else {
			showMessage(t('add.offlinePhotoNotAttached'));
		}
	}

	const isShared = document.getElementById('sharedSessionCheck')?.checked && sessionParticipants.length > 0;

	if (isShared) {
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
}
	async function deleteItem(ts) {
		if(!confirm(t('history.confirmDeleteEntry'))) return;

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
        setTimeout(() => initAddPlaceMap(), 150);
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
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(var(--overlay-rgb),0.05); border-radius: 8px; margin-bottom: 5px;">
            <span style="font-size: 14px; font-weight: 500;">${p.name}</span>
            <button onclick="deletePlace(${p.id})" style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 16px;">🗑️</button>
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
	function showPage(p) {
		document.querySelectorAll(".page").forEach(pg => pg.classList.remove("active"));
		document.getElementById("page-" + p).classList.add("active");

		document.querySelectorAll(".menu-content button").forEach(btn => btn.classList.remove("active-tab"));
		const pageToIndex = { 'home': 0, 'add': 1, 'history': 2, 'gallery': 3, 'stats': 4, 'charts': 5, 'map': 6, 'social': 7, 'stock': 8, 'settings': 9 };
		const activeBtn = document.querySelectorAll(".menu-content button")[pageToIndex[p]];
		if(activeBtn) activeBtn.classList.add("active-tab");

		refreshPageDynamicContent(p);
	}

	// Ricarica i dati/render dinamici di una pagina. Estratto da showPage() così può essere
	// richiamato anche al cambio lingua, per aggiornare il testo generato via JS senza reload.
	function refreshPageDynamicContent(p) {
		if (p === 'gallery') loadGallery();

		if (p === 'map') {
			loadUserPlaces();
			setTimeout(() => {
				initMap();
				updateMap();
			}, 100);
		}

		if (p === 'social') { loadSocial(); loadSnapshots(); loadFriendRequests(); }
		if (p === 'stock' || p === 'charts') loadPurchases();
		if (p === 'settings') {
		    loadUserProfile();
		    loadReminderSettings();
		    loadPushDevices();
		    loadBackupStatus();
		}
		update();
	}

	function getCurrentPageName() {
		const activePage = document.querySelector('.page.active');
		return activePage ? activePage.id.replace('page-', '') : null;
	}

	document.addEventListener('i18n:change', () => {
		const p = getCurrentPageName();
		if (p && p !== 'auth') refreshPageDynamicContent(p);
		if (document.getElementById('tutorialModal')?.style.display === 'flex') renderTutorialStep();
	});

	// ========== MAPPA (CORRETTA DAL PRIMO CODICE) ==========
	let markerClusterGroup = null; // Aggiungi questa variabile globale all'inizio

function initMap() {
    if (mapInstance) mapInstance.remove();
    mapInstance = L.map('mapContainer').setView([45.46, 9.19], 10);
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
    
    if (filter === 'fumo') filteredSmokes = smokes.filter(s => s.fumo_grams > 0);
    else if (filter === 'erba') filteredSmokes = smokes.filter(s => s.erba_grams > 0);

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
                🌿 ${place.name}<br>
                <span style="font-size: 11px; font-weight: normal;">${place.count}x · ${place.grams.toFixed(1)}g</span>
            </div>`,
            iconSize: null,
            iconAnchor: [25, 20]
        });

        const marker = L.marker([place.lat, place.lng], { icon: markerEl })
            .bindPopup(`<strong>📍 ${place.name}</strong><br>${t('places.sessionsPopup', { count: place.count })}<br>${t('places.totalPopup', { grams: place.grams.toFixed(1) })}`);

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
            .bindPopup(`<strong>${s.location_name || t('places.locationFallback')}</strong><br>${s.date} ${s.time}<br>${parseFloat(personalGrams(s).toFixed(2))}g`);

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
        <div class="stat-box"><big>${totalGrams.toFixed(1)}g</big><small>${t('places.statTotal')}</small></div>
    `;
}

	// ========== AGGIORNAMENTO GENERALE ==========
	function update() {
		updateHistory();
		updateStats();
		renderCharts();
		checkReminderBanner();
		renderPeriodComparison();
		renderHomeSummary();
		renderInsights();
		renderContextStats();
		renderGoalCard();
		if (achievementsLoaded) checkAchievements();
	}

	// ========== HOME: riepilogo ==========
	function renderHomeSummary() {
		const greetingEl = document.getElementById('homeGreeting');
		if (!greetingEl) return;

		const hour = new Date().getHours();
		const greeting = hour < 6 ? t('home.greetingNight') : hour < 12 ? t('home.greetingMorning') : hour < 18 ? t('home.greetingAfternoon') : t('home.greetingEvening');
		greetingEl.textContent = greeting;

		document.getElementById('homeStreak').textContent = calculateStreak();

		const now = new Date();
		const currentMonthKey = getMonthKey(now);
		const monthSmokes = smokes.filter(s => getMonthKey(s.date) === currentMonthKey);
		const monthGrams = monthSmokes.reduce((sum, s) => sum + (s.my_fumo_grams ?? s.fumo_grams ?? 0) + (s.my_erba_grams ?? s.erba_grams ?? 0), 0);
		document.getElementById('homeMonthStat').textContent = tn('home.monthStat', monthSmokes.length, { grams: monthGrams.toFixed(1) });

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

// ========== FOTO SESSIONE ==========
let selectedPhotoFile = null;

function handlePhotoSelected(event) {
	const file = event.target.files[0];
	if (!file) return;

	if (file.size > 8 * 1024 * 1024) {
		alert(t('gallery.photoTooLarge'));
		event.target.value = '';
		return;
	}

	selectedPhotoFile = file;
	const reader = new FileReader();
	reader.onload = e => {
		document.getElementById('photoPreview').src = e.target.result;
		document.getElementById('photoPreviewWrap').style.display = 'block';
	};
	reader.readAsDataURL(file);
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
async function loadGallery() {
	const el = document.getElementById('galleryGrid');
	if (!el) return;
	el.innerHTML = '<div class="spinner"></div>';

	const withPhotos = [...smokes].filter(s => s.photo_path).sort((a, b) => b.ts - a.ts);

	if (withPhotos.length === 0) {
		el.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--color-text-muted); font-size:13px; padding:20px 0;">${t('gallery.noPhotosYet')}</p>`;
		return;
	}

	const paths = withPhotos.map(s => s.photo_path);
	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrls(paths, 3600);

	if (error || !data) {
		el.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--color-text-muted); font-size:13px;">${t('gallery.loadPhotosError')}</p>`;
		return;
	}

	el.innerHTML = withPhotos.map((s, i) => {
		const signed = data[i]?.signedUrl;
		if (!signed) return '';
		return `
			<div onclick="openPhotoViewer(${s.ts})" style="aspect-ratio:1; border-radius:10px; overflow:hidden; cursor:pointer; background:rgba(var(--overlay-rgb),0.08);">
				<img src="${signed}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;">
			</div>
		`;
	}).join('');
}

let currentViewerTs = null;

async function openPhotoViewer(ts) {
	const session = smokes.find(s => s.ts === ts);
	if (!session || !session.photo_path) return;

	currentViewerTs = ts;
	document.getElementById('photoViewerImg').src = '';
	document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--color-text-muted);">${t('common.loading')}</p>`;
	document.getElementById('photoViewerDeleteBtn').style.display = 'block';
	document.getElementById('photoViewerModal').style.display = 'flex';

	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrl(session.photo_path, 3600);

	if (error || !data) {
		document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--danger);">${t('gallery.loadPhotoError')}</p>`;
		return;
	}

	document.getElementById('photoViewerImg').src = data.signedUrl;
	document.getElementById('photoViewerInfo').innerHTML = `
		<strong>${session.date.split('-').reverse().join('/')} · ${session.time}</strong><br>
		<span style="color:var(--color-text-muted); font-size:13px;">
			${session.type === 'fumo' ? t('common.smoke') : session.type === 'erba' ? t('common.weed') : t('common.smokeWeed')} · ${parseFloat(personalGrams(session).toFixed(2))}g
			${session.location_name ? ' · 📍 ' + session.location_name : ''}
		</span>
	`;
}

// ========== ISTANTANEE (foto tue + amici) ==========
let snapshotItems = [];

async function loadSnapshots() {
	const el = document.getElementById('snapshotsGrid');
	if (!el) return;
	el.innerHTML = '<div class="spinner"></div>';

	const { data, error } = await supabaseClient.rpc('get_friends_snapshots', { limit_count: 24 });
	if (error) {
		console.error('Errore istantanee:', error);
		el.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--color-text-muted); font-size:13px;">${t('social.loadSnapshotsError')}</p>`;
		return;
	}

	snapshotItems = data || [];

	if (snapshotItems.length === 0) {
		el.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--color-text-muted); font-size:13px; padding:10px 0;">${t('social.noSnapshotsYet')}</p>`;
		return;
	}

	const paths = snapshotItems.map(s => s.photo_path);
	const { data: signedData, error: signedError } = await supabaseClient.storage.from('session-photos').createSignedUrls(paths, 3600);

	if (signedError || !signedData) {
		el.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--color-text-muted); font-size:13px;">${t('gallery.loadPhotosError')}</p>`;
		return;
	}

	el.innerHTML = snapshotItems.map((s, i) => {
		const signed = signedData[i]?.signedUrl;
		if (!signed) return '';
		const isMe = s.user_id === currentUser.id;
		return `
			<div onclick="openSnapshotViewer(${i})" style="position:relative; aspect-ratio:1; border-radius:10px; overflow:hidden; cursor:pointer; background:rgba(var(--overlay-rgb),0.08);">
				<img src="${signed}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;">
				<span style="position:absolute; bottom:4px; left:4px; right:4px; background:rgba(0,0,0,0.55); color:white; font-size:10px; padding:2px 6px; border-radius:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${isMe ? t('shared.you') : s.username}</span>
			</div>
		`;
	}).join('');
}

async function openSnapshotViewer(index) {
	const s = snapshotItems[index];
	if (!s) return;

	const isMe = s.user_id === currentUser.id;
	currentViewerTs = isMe ? s.ts : null;

	document.getElementById('photoViewerImg').src = '';
	document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--color-text-muted);">${t('common.loading')}</p>`;
	document.getElementById('photoViewerDeleteBtn').style.display = isMe ? 'block' : 'none';
	document.getElementById('photoViewerModal').style.display = 'flex';

	const { data, error } = await supabaseClient.storage.from('session-photos').createSignedUrl(s.photo_path, 3600);

	if (error || !data) {
		document.getElementById('photoViewerInfo').innerHTML = `<p style="text-align:center; color:var(--danger);">${t('gallery.loadPhotoError')}</p>`;
		return;
	}

	document.getElementById('photoViewerImg').src = data.signedUrl;
	const grams = (s.my_fumo_grams || 0) + (s.my_erba_grams || 0);
	document.getElementById('photoViewerInfo').innerHTML = `
		<strong>${isMe ? t('shared.you') : s.username}</strong> · ${s.date.split('-').reverse().join('/')} · ${s.time}<br>
		<span style="color:var(--color-text-muted); font-size:13px;">
			${s.type === 'fumo' ? t('common.smoke') : s.type === 'erba' ? t('common.weed') : t('common.smokeWeed')} · ${grams.toFixed(2)}g
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
	if (!confirm(t('gallery.deletePhotoConfirm'))) return;

	const session = smokes.find(s => s.ts === currentViewerTs);
	if (!session || !session.photo_path) return;

	await supabaseClient.storage.from('session-photos').remove([session.photo_path]);
	const { error } = await supabaseClient.from('smokes').update({ photo_path: null }).eq('ts', currentViewerTs);

	if (error) { alert(t('gallery.deletePhotoError')); return; }

	closePhotoViewer();
	showMessage(t('gallery.photoRemoved'));
	await loadData();
	await loadGallery();
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
		t('modals.editLocationSessionInfo', { date: session.date.split('-').reverse().join('/'), time: session.time }) +
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
						📍 ${p.name}
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

	const { error } = await supabaseClient.from('smokes').update(update).eq('ts', editingLocationTs);
	if (error) { alert(t('modals.locationSaveError')); return; }

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
	const resetBtn = document.getElementById('historyFilterReset');
	if (resetBtn) resetBtn.style.display = isHistoryFilterActive() ? 'block' : 'none';
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

function updateHistory() {
	const hList = document.getElementById("historyList");
	hList.innerHTML = "";

	const filterActive = isHistoryFilterActive();
	const visibleSmokes = filterActive ? getFilteredHistorySmokes() : smokes;

	if (smokes.length === 0) {
		hList.innerHTML = "<p style='text-align:center; color:var(--color-text-muted);'>Nessun dato presente.</p>";
	} else if (visibleSmokes.length === 0) {
		hList.innerHTML = "<p style='text-align:center; color:var(--color-text-muted);'>Nessun risultato per questi filtri.</p>";
	} else {
		const months = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
		const byYear = {};

		visibleSmokes.forEach(s => {
			const d = new Date(s.date);
			const year = d.getFullYear();
			const monthIndex = d.getMonth();
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
				const firstDateOfMonth = Math.max(...Object.keys(byYear[year][mKey]).map(d => new Date(d).getTime()));
				return { mKey, firstDateOfMonth };
			});
			const monthKeys = monthKeysWithDates.sort((a, b) => b.firstDateOfMonth - a.firstDateOfMonth).map(x => x.mKey);

			monthKeys.forEach(mKey => {
				let mGrams = 0;
				let daysHtml = "";

				// GIORNI DECRESCENTI (più recente primo)
				const dayKeys = Object.keys(byYear[year][mKey]).sort((a, b) => new Date(b) - new Date(a));
				
				dayKeys.forEach(dKey => {
					const daySmokes = byYear[year][mKey][dKey];
					const dayWeight = daySmokes.reduce((sum, s) => sum + personalGrams(s), 0);
					mGrams += dayWeight;
					yearGrams += dayWeight;

					const dDisplay = dKey.split('-').reverse().join('/');

					// SESSIONI DECRESCENTI PER ORA
					const sortedSmokes = [...daySmokes].sort((a, b) => b.time.localeCompare(a.time));

					let itemsHtml = sortedSmokes.map(s => `
    <div class="history-item">
        <div>
            <span style="font-weight: bold; color: var(--primary);">${s.time}</span> - <b>${s.type === 'fumo' ? '🍫' : s.type === 'erba' ? '🍃' : '🍫🍃'}</b> ${parseFloat(personalGrams(s).toFixed(2))}g
            ${s.not_mine ? `<span style="background:var(--warning-bg); color:var(--warning-text); font-size:11px; padding:1px 7px; border-radius:20px; margin-left:4px; font-weight:600;">👥 non mia</span>` : ''}
            <br><small style="color: var(--color-text-muted);">${s.location_name ? `📍 ${s.location_name}` : '📍 <em>nessuna posizione</em>'} <a onclick="openEditLocationModal(${s.ts})" style="color:var(--primary-light); cursor:pointer; text-decoration:underline;">modifica</a>${s.photo_path ? ` · <a onclick="openPhotoViewer(${s.ts})" style="cursor:pointer;">📷</a>` : ''}</small>
        </div>
        <button class="del-btn" onclick="deleteItem(${s.ts})">🗑️</button>
    </div>
`).join('');

					// TUTTO CHIUSO (display: none)
					daysHtml += `
						<div class="day-group">
							<div class="day-header" onclick="toggleAccordion(this)">
								<span>📅 ${dDisplay}</span>
								<span>${dayWeight.toFixed(1)}g <span class="chevron">▼</span></span>
							</div>
							<div class="day-content" style="display: none;">${itemsHtml}</div>
						</div>`;
				});

				// TUTTO CHIUSO (display: none)
				monthsHtml += `
					<div class="month-group">
						<div class="month-header" onclick="toggleAccordion(this)">
							<span>📂 ${mKey}</span>
							<span>${mGrams.toFixed(1)}g <span class="chevron">▼</span></span>
						</div>
						<div class="month-content" style="display: none;">${daysHtml}</div>
					</div>`;
			});

			// TUTTO CHIUSO (display: none)
			hList.innerHTML += `
				<div class="year-group">
					<div class="year-header" onclick="toggleAccordion(this)">
						<span>📅 ${year}</span>
						<span>${yearGrams.toFixed(1)}g <span class="chevron">▼</span></span>
					</div>
					<div class="year-content" style="display: none;">${monthsHtml}</div>
				</div>`;
		});
	}
}

	function updateStats() {
		let totF = 0, totE = 0;
smokes.forEach(s => { 
	totF += (s.my_fumo_grams ?? s.fumo_grams ?? 0);
	totE += (s.my_erba_grams ?? s.erba_grams ?? 0);
});

		document.getElementById("sFumo").innerText = totF.toFixed(2);
		document.getElementById("sErba").innerText = totE.toFixed(2);
		document.getElementById("sJTot").innerText = smokes.length;
		document.getElementById("sGTot").innerText = (totF + totE).toFixed(2);

		let diffDays = 1;
		if (smokes.length > 0) {
			const sortedSmokes = [...smokes].sort((a,b) => new Date(a.date) - new Date(b.date));
			const firstJ = new Date(sortedSmokes[0].date);
			const today = new Date();
			diffDays = Math.ceil(Math.abs(today - firstJ) / (1000 * 60 * 60 * 24)) || 1;
		}
		document.getElementById("diffDays").innerText = diffDays.toFixed(0);

		document.getElementById("avgDaily").innerText = (smokes.length / diffDays).toFixed(2);
		document.getElementById("avgMonthly").innerText = ((smokes.length / diffDays) * 30.44).toFixed(1);
		document.getElementById("avgYearly").innerText = ((smokes.length / diffDays) * 365.25).toFixed(1);
		document.getElementById("avgGrams").innerText = ((totF + totE) / diffDays).toFixed(2) + "g";

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

	function calculateStreak() {
		if (smokes.length === 0) return 0;

		const days = [...new Set(smokes.map(s => s.date))].sort();
		let streak = 1;

		for (let i = days.length - 1; i > 0; i--) {
			const today = new Date(days[i]);
			const yesterday = new Date(days[i - 1]);
			today.setHours(0,0,0,0);
			yesterday.setHours(0,0,0,0);
			const diff = (today - yesterday) / (1000 * 60 * 60 * 24);
			if (diff === 1) streak++;
			else break;
		}

		const last = new Date(days[days.length - 1]);
		const now = new Date();
		last.setHours(0,0,0,0);
		now.setHours(0,0,0,0);
		const diffFromToday = (now - last) / (1000 * 60 * 60 * 24);
		if (diffFromToday > 1) return 0;

		return streak;
	}

	async function updateBestStreak(currentStreak) {
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
        const name = s.location_name || '❓ Sconosciuta';
        if (!grouped[name]) grouped[name] = { j: 0, fumo: 0, erba: 0 };
        grouped[name].j++;
        grouped[name].fumo += (s.my_fumo_grams ?? s.fumo_grams ?? 0);
        grouped[name].erba += (s.my_erba_grams ?? s.erba_grams ?? 0);
    });

    if (Object.keys(grouped).length === 0) {
        el.innerHTML = '<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Nessun dato con posizione.</p>';
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
                <span style="font-weight:600; font-size:14px;">${isSaved ? '📍' : '🌍'} ${name}</span><br>
                <small style="color:var(--color-text-muted);">🍫 ${data.fumo.toFixed(1)}g &nbsp; 🍃 ${data.erba.toFixed(1)}g</small>
            </div>
            <div style="text-align:right;">
                <span style="font-size:18px; font-weight:700; color:var(--primary);">${data.j}</span><br>
                <small style="color:var(--color-text-muted);">joint</small>
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

	function renderCharts() {
		Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
		charts = {};

		renderCalendarHeatmap();

		let gramsFumo = smokes.reduce((sum, s) => sum + (s.my_fumo_grams ?? s.fumo_grams ?? 0), 0);
let gramsErba = smokes.reduce((sum, s) => sum + (s.my_erba_grams ?? s.erba_grams ?? 0), 0);

// Grafico a ciambella
const ctxPie = document.getElementById("cPie");
if (ctxPie) {
	charts.pie = new Chart(ctxPie, {
		type: 'doughnut',
		data: { 
			labels: ['Fumo', 'Erba'], 
			datasets: [{ 
				data: [gramsFumo, gramsErba], 
				backgroundColor: ['#795548', '#4CAF50'] 
			}]
		},
				options: { maintainAspectRatio: false }
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
				monthLabels.push(d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }));
			}

			const spendingByMonth = computeMonthlySpending(monthKeys);

			charts.spending = new Chart(ctxSpending, {
				type: 'bar',
				data: {
					labels: monthLabels,
					datasets: [{
						label: 'Spesa (€)',
						data: spendingByMonth,
						backgroundColor: '#9c27b0'
					}]
				},
				options: {
					maintainAspectRatio: false,
					plugins: {
						tooltip: {
							callbacks: {
								label: (ctx) => `€${ctx.parsed.y.toFixed(2)}`
							}
						}
					}
				}
			});
		}

		// Grafico ultimi 7 giorni
		const last7 = [...Array(7)].map((_,i) => { let d = new Date(); d.setDate(d.getDate()-i); return d.toISOString().split('T')[0]; }).reverse();
		const weightData = last7.map(d => smokes.filter(s => s.date === d).reduce((acc, curr) => acc + personalGrams(curr), 0));

		const ctxWeight = document.getElementById("cWeight");
		if (ctxWeight) {
			charts.weight = new Chart(ctxWeight, {
				type: 'line',
				data: { 
					labels: last7.map(d => d.slice(8)), 
					datasets: [{ 
						label: 'Grammi', 
						data: weightData, 
						borderColor: '#2e7d32', 
						backgroundColor: 'rgba(46,125,50,0.1)', 
						fill: true 
					}]
				},
				options: { maintainAspectRatio: false }
			});
		}

		// Grafico completo giornaliero
		const dailyMap = {};
		smokes.forEach(s => { if (!dailyMap[s.date]) dailyMap[s.date] = 0; dailyMap[s.date]++; });
		const sortedDates = Object.keys(dailyMap).sort();
		const dailyCounts = sortedDates.map(d => dailyMap[d]);

		const ctxDaily = document.getElementById("cDailyAll");
		if (ctxDaily) {
			charts.dailyAll = new Chart(ctxDaily, {
				type: 'line',
				data: { 
					labels: sortedDates.map(d => d.split("-").reverse().join("/")), 
					datasets: [{ 
						label: 'Joint', 
						data: dailyCounts, 
						borderColor: '#1b5e20', 
						backgroundColor: 'rgba(27,94,32,0.1)', 
						fill: true, 
						tension: 0.3 
					}]
				},
				options: { maintainAspectRatio: false }
			});
		}

		// Grafico giorni della settimana
		const weekDays = { "Domenica": 0, "Lunedì": 0, "Martedì": 0, "Mercoledì": 0, "Giovedì": 0, "Venerdì": 0, "Sabato": 0 };
		smokes.forEach(s => { 
			const d = new Date(s.date); 
			const dayIndex = d.getDay(); 
			const names = Object.keys(weekDays); 
			weekDays[names[dayIndex]]++; 
		});

		const ctxWeek = document.getElementById("cWeekDays");
		if (ctxWeek) {
			charts.week = new Chart(ctxWeek, {
				type: 'bar',
				data: { 
					labels: Object.keys(weekDays), 
					datasets: [{ 
						label: 'Joint', 
						data: Object.values(weekDays), 
						backgroundColor: '#66bb6a' 
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
					labels: Object.keys(hours), 
					datasets: [{ 
						data: Object.values(hours), 
						backgroundColor: ['#2c3e50','#f1c40f','#e67e22','#2980b9'] 
					}]
				},
				options: { maintainAspectRatio: false }
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
		const conferma = confirm("ATTENZIONE: Questa operazione cancellerà DEFINITIVAMENTE tutte le tue sessioni salvate. Non potrai tornare indietro. Sei davvero sicuro?");
		
		if (conferma) {
			const confermaFinale = prompt("Per confermare la cancellazione totale, scrivi 'ELIMINA' (tutto maiuscolo):");
			
			if (confermaFinale === "ELIMINA") {
				try {
					const { error } = await supabaseClient
						.from('smokes')
						.delete()
						.eq('user_id', currentUser.id);

					if (error) throw error;

					showMessage("✅ Tutti i dati sono stati cancellati.");
					await loadData();
					showPage('add');
				} catch (err) {
					console.error(err);
					alert("Errore durante il reset.");
				}
			} else {
				alert("Reset annullato.");
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

	async function loadSocial() {
		const list = document.getElementById('leaderboardList');
		if (!list) return;

		list.innerHTML = '<div class="spinner"></div>';

		if (!currentUser) {
			list.innerHTML = "<p style='text-align:center;'>Effettua il login per vedere la classifica.</p>";
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
				list.innerHTML = "<p class='error'>Errore nel recupero dati dal database.</p>";
				return;
			}

			if (!data || data.length === 0) {
				list.innerHTML = `<p style='text-align:center; padding: 20px;'>
					${isGlobal ? "Nessun dato globale." : "Non hai ancora amici. Aggiungili con il loro nickname!"}
				</p>`;
				return;
			}

			let sharedMap = {};
			if (!isGlobal) {
				const { data: sharedData } = await supabaseClient.rpc('get_all_friends_shared_stats');
				if (sharedData) {
					sharedData.forEach(s => { sharedMap[s.friend_id] = s; });
				}
			}

			list.innerHTML = data.map((u, i) => {
				const rankStr = i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`;
				const rankClass = i < 3 ? 'top3' : '';
				const isMe = u.user_id === currentUser.id;

				const shared = sharedMap[u.user_id];
				const sharedBadge = (!isGlobal && shared && shared.sessions_together > 0)
					? `<br><small style="color: var(--primary-light); font-weight:600;">👥 ${shared.sessions_together} insieme</small>`
					: '';

				return `
					<div class="lb-item" onclick="viewFriendStats('${u.user_id}', '${u.username}')" 
						 style="${isMe ? 'background: rgba(76, 175, 80, 0.1);' : ''}">
						<div style="display: flex; align-items: center;">
							<span class="lb-rank ${rankClass}">${rankStr}</span>
							<span style="font-weight: ${isMe ? 'bold' : '500'};">
								${u.username} ${isMe ? '(Tu)' : ''}
								${sharedBadge}
							</span>
						</div>
						<div style="text-align: right;">
							<span style="font-weight: bold; color: var(--primary);">${Number(u.total_g).toFixed(1)}g</span><br>
							<small style="color: var(--color-text-muted);">${u.total_j} joint</small>
						</div>
					</div>
				`;
			}).join('');

		} catch (err) {
			console.error("Errore generico loadSocial:", err);
			list.innerHTML = "<p class='error'>Errore di connessione.</p>";
		}
	}

	async function loadSharedLeaderboard() {
		const list = document.getElementById('leaderboardList');

		try {
			const { data, error } = await supabaseClient.rpc('get_friends_shared_leaderboard', { period: sharedPeriod });

			if (error) {
				console.error("Errore leaderboard condivise:", error);
				list.innerHTML = "<p class='error'>Errore nel recupero dati dal database.</p>";
				return;
			}

			const filtered = (data || []).filter(u => u.sessions_together > 0);

			if (filtered.length === 0) {
				list.innerHTML = `<p style='text-align:center; padding: 20px;'>
					${sharedPeriod === 'month' ? "Nessuna sessione condivisa questo mese." : "Nessuna sessione condivisa ancora."}
				</p>`;
				return;
			}

			list.innerHTML = filtered.map((u, i) => {
				const rankStr = i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`;
				const rankClass = i < 3 ? 'top3' : '';

				return `
					<div class="lb-item" onclick="viewFriendStats('${u.friend_id}', '${u.username}')">
						<div style="display: flex; align-items: center;">
							<span class="lb-rank ${rankClass}">${rankStr}</span>
							<span style="font-weight: 500;">🤝 ${u.username}</span>
						</div>
						<div style="text-align: right;">
							<span style="font-weight: bold; color: var(--primary);">${u.sessions_together}</span><br>
							<small style="color: var(--color-text-muted);">${Number(u.grams_together).toFixed(1)}g insieme</small>
						</div>
					</div>
				`;
			}).join('');

		} catch (err) {
			console.error("Errore generico leaderboard condivise:", err);
			list.innerHTML = "<p class='error'>Errore di connessione.</p>";
		}
	}

	async function addFriend() {
		const username = document.getElementById('friendUsername').value.trim();
		if (!username) return alert("Inserisci un nickname");

		const { error } = await supabaseClient.rpc('send_friend_request', { target_username: username });

		if (error) {
			if (error.message && error.message.includes('non trovato')) alert("Utente non trovato!");
			else if (error.message && error.message.includes('te stesso')) alert("Non puoi aggiungere te stesso!");
			else if (error.message && error.message.includes('gia')) alert("Richiesta già inviata o siete già amici!");
			else alert("Errore durante l'invio della richiesta.");
		} else {
			showMessage("👥 Richiesta di amicizia inviata!");
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
			<h3 style="margin-top:0;">🔔 Richieste di amicizia</h3>
			${data.map(r => `
				<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(76,175,80,0.08); border-radius:10px; margin-bottom:8px;">
					<span style="font-weight:600; font-size:14px;">👤 ${r.username}</span>
					<div style="display:flex; gap:8px;">
						<button class="action-btn" onclick="respondFriendRequest('${r.requester_id}', true)" style="margin-top:0; padding:8px 14px;">✅ Accetta</button>
						<button class="secondary-btn" onclick="respondFriendRequest('${r.requester_id}', false)" style="margin-top:0; padding:8px 14px;">✕ Rifiuta</button>
					</div>
				</div>
			`).join('')}
		`;
	}

	async function respondFriendRequest(requesterId, accept) {
		const { error } = await supabaseClient.rpc('respond_friend_request', { requester_id: requesterId, accept });
		if (error) { alert('Errore nella risposta alla richiesta.'); return; }

		showMessage(accept ? '🤝 Amicizia accettata!' : 'Richiesta rifiutata');
		await loadFriendRequests();
		if (currentSocialTab === 'friends') loadSocial();
	}

	let currentModalFriendId = null;

	async function viewFriendStats(targetId, username) {
		const { data, error } = await supabaseClient.rpc('get_friend_stats', { target_user_id: targetId });

		if (error || !data || data.length === 0) return alert("Impossibile caricare le statistiche.");

		document.getElementById('modalFriendName').innerText = `📊 Statistiche di ${username}`;
		document.getElementById('modaleFumo').innerText = data[0].fumo_g.toFixed(1);
		document.getElementById('modaleErba').innerText = data[0].erba_g.toFixed(1);

		const { data: shared } = await supabaseClient.rpc('get_shared_stats', { target_user_id: targetId });
		const sharedEl = document.getElementById('modaleShared');
		if (sharedEl && shared && shared[0]) {
			sharedEl.innerText = `👥 ${shared[0].sessions_together} sessioni insieme · ${Number(shared[0].grams_together).toFixed(1)}g`;
		} else if (sharedEl) {
			sharedEl.innerText = "";
		}

		currentModalFriendId = targetId;
		const removeBtn = document.getElementById('btnRemoveFriendModal');
		if (removeBtn) removeBtn.style.display = (currentSocialTab === 'friends') ? 'block' : 'none';

		document.getElementById('friendModal').style.display = 'flex';
	}

	async function removeFriendFromModal() {
		if (!currentModalFriendId) return;
		if (!confirm("Rimuovere questa amicizia? Non vedrete più a vicenda le rispettive statistiche e foto.")) return;

		const { error } = await supabaseClient.rpc('remove_friend', { target_id: currentModalFriendId });
		if (error) { alert("Errore nella rimozione dell'amicizia."); return; }

		showMessage('🗑️ Amicizia rimossa');
		closeFriendModal();
		loadSocial();
	}

	function closeFriendModal() {
		document.getElementById('friendModal').style.display = 'none';
	}

	// ========== PROFILO ==========
	async function updateProfile() {
		const newName = document.getElementById('usernameInput').value.trim();
		if(newName.length < 3) return alert("Il nickname deve avere almeno 3 caratteri!");
		if(/[<>"'`&]/.test(newName)) return alert("Il nickname non può contenere < > \" ' ` &");

		const { error } = await supabaseClient
			.from('profiles')
			.upsert({ id: currentUser.id, username: newName });

		if (error) {
			alert(error.code === '23505' ? "❌ Nickname già in uso! Scegline un altro." : "Errore salvataggio profilo.");
		} else {
			showMessage("✅ Nickname aggiornato!");
			document.getElementById('usernameInput').value = "";
			loadUserProfile();
		}
	}

	async function loadUserProfile() {
		const emailEl = document.getElementById('settingsEmailDisplay');
		if (emailEl) emailEl.textContent = currentUser.email;

		const { data, error } = await supabaseClient
			.from('profiles')
			.select('username')
			.eq('id', currentUser.id)
			.single();

		if (data && data.username) {
			document.getElementById('currentUsernameDisplay').innerText = data.username;
			document.getElementById('usernameInput').value = data.username;
		}
	}


    async function loadAchievements() {
	const { data, error } = await supabaseClient
		.from('achievements_unlocked')
		.select('achievement_key');

	if (!error) {
		unlockedAchievements = (data || []).map(a => a.achievement_key);
	}

	const { count } = await supabaseClient
		.from('friendships')
		.select('id', { count: 'exact', head: true })
		.eq('user_id', currentUser.id);
	friendsCountCache = count || 0;

	achievementsLoaded = true;
	await checkAchievements();
	renderAchievements();
}

async function checkAchievements() {
	for (const ach of ACHIEVEMENTS) {
		if (unlockedAchievements.includes(ach.key)) continue;
		if (ach.check()) {
			unlockedAchievements.push(ach.key);
			await supabaseClient.from('achievements_unlocked').upsert({
				user_id: currentUser.id,
				achievement_key: ach.key
			}, { onConflict: 'user_id,achievement_key' });
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

async function loadBreaks() {
	const { data, error } = await supabaseClient
		.from('tolerance_breaks')
		.select('*')
		.order('start_date', { ascending: false });

	if (error) { console.error('Errore caricamento pause:', error); return; }

	allBreaks = data || [];
	activeBreak = allBreaks.find(b => b.is_active) || null;
	renderBreakCard();
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
	const totalGrams = before.reduce((s, x) => s + (x.my_fumo_grams ?? x.fumo_grams ?? 0) + (x.my_erba_grams ?? x.erba_grams ?? 0), 0);
	const dates = [...new Set(before.map(s => s.date))].sort();
	const firstDate = new Date(dates[0]);
	const lastDate = new Date(breakStartDate);
	const diffDays = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)));
	return totalGrams / diffDays;
}

function renderBreakCard() {
	const el = document.getElementById('breakCard');
	if (!el) return;

	if (activeBreak) {
		const start = new Date(activeBreak.start_date);
		const today = new Date();
		const days = Math.max(0, Math.floor((today - start) / (1000 * 60 * 60 * 24)));

		const avgDaily = getAvgDailyGramsBeforeBreak(activeBreak.start_date);
		const pricePerGram = getAvgPricePerGram();
		const savedGrams = avgDaily * days;
		const savedMoney = pricePerGram ? (savedGrams * pricePerGram) : null;

		el.innerHTML = `
			<div style="text-align:center; padding:10px;">
				<div style="font-size:36px; font-weight:800; color:var(--primary);">${days}</div>
				<div style="font-size:13px; color:var(--color-text-secondary); margin-bottom:15px;">giorni senza fumare 💪</div>
				${savedMoney !== null ? `<div style="font-size:15px; font-weight:700; color:#9c27b0;">💰 ~€${savedMoney.toFixed(2)} risparmiati</div>` : ''}
				<div style="font-size:12px; color:var(--color-text-muted); margin-top:4px;">~${savedGrams.toFixed(1)}g non consumati</div>
				<button class="secondary-btn" onclick="endBreak()" style="margin-top:15px;">Interrompi pausa</button>
			</div>
		`;
	} else {
		el.innerHTML = `
			<p style="text-align:center; color:var(--color-text-muted); font-size:13px; margin-bottom:10px;">Nessuna pausa attiva.</p>
			<button class="main-btn" onclick="startBreak()" style="margin-top:0;">💤 Inizia una pausa</button>
		`;
	}

	renderBreakHistory();
}

function renderBreakHistory() {
	const el = document.getElementById('breakHistory');
	if (!el) return;

	const past = allBreaks.filter(b => !b.is_active);
	if (past.length === 0) { el.innerHTML = ''; return; }

	el.innerHTML = '<hr style="margin:15px 0;"><p style="font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">Pause precedenti</p>' +
		past.map(b => {
			const days = Math.ceil((new Date(b.end_date) - new Date(b.start_date)) / (1000 * 60 * 60 * 24));
			return `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); font-size:13px;">
				<span>${b.start_date.split('-').reverse().join('/')} → ${b.end_date.split('-').reverse().join('/')}</span>
				<span style="font-weight:600; color:var(--primary);">${days}g</span>
			</div>`;
		}).join('');
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

	const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
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
				? `<div title="${d.date.split('-').reverse().join('/')}: ${d.count} sessione/i" style="width:11px; height:11px; border-radius:2px; background:${colorFor(d.count)};"></div>`
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
			<p style="text-align:center; color:var(--color-text-muted); font-size:13px; margin-bottom:10px;">Nessun obiettivo impostato.</p>
			<select id="goalMetric" style="margin-top:0;">
				<option value="sessions">Numero sessioni</option>
				<option value="grams">Grammi totali</option>
			</select>
			<select id="goalPeriod" style="margin-top:10px;">
				<option value="week">a settimana</option>
				<option value="month">al mese</option>
			</select>
			<input type="number" id="goalTarget" min="0.1" step="0.1" placeholder="Valore massimo" style="margin-top:10px;">
			<button class="main-btn" onclick="setGoal()" style="margin-top:10px;">🎯 Imposta obiettivo</button>
		`;
		return;
	}

	const now = new Date();
	let periodStart, periodLabel;
	if (activeGoal.period === 'week') {
		periodStart = getWeekStart(now);
		periodLabel = 'questa settimana';
	} else {
		periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
		periodLabel = 'questo mese';
	}
	const periodStartStr = toDateStr(periodStart);

	const periodSmokes = smokes.filter(s => s.date >= periodStartStr && !s.not_mine);
	const isSessions = activeGoal.metric === 'sessions';
	const current = isSessions
		? periodSmokes.length
		: periodSmokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const target = parseFloat(activeGoal.target_value);

	const pct = Math.min(100, (current / target) * 100);
	const isOver = current > target;
	const barColor = isOver ? '#f44336' : pct > 75 ? '#FF9800' : '#4CAF50';
	const unit = isSessions ? '' : 'g';
	const metricLabel = isSessions ? 'sessioni' : 'grammi';
	const decimals = isSessions ? 0 : 1;

	el.innerHTML = `
		<div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
			<span style="font-size:13px; color:var(--color-text-secondary);">${metricLabel} ${periodLabel}</span>
			<span style="font-weight:700; color:${barColor};">${current.toFixed(decimals)}${unit} / ${target.toFixed(decimals)}${unit}</span>
		</div>
		<div style="background:rgba(var(--overlay-rgb),0.12); border-radius:8px; height:10px; overflow:hidden;">
			<div style="height:100%; width:${pct}%; background:${barColor}; border-radius:8px; transition: width 0.5s ease;"></div>
		</div>
		${isOver ? `<p style="font-size:12px; color:var(--danger); margin-top:8px; text-align:center;">⚠️ Obiettivo superato per ${periodLabel}</p>` : ''}
		<button class="secondary-btn" onclick="removeGoal()" style="margin-top:12px;">Rimuovi obiettivo</button>
	`;
}

async function setGoal() {
	const metric = document.getElementById('goalMetric').value;
	const period = document.getElementById('goalPeriod').value;
	const target = parseFloat(document.getElementById('goalTarget').value);
	if (!target || target <= 0) return alert('Inserisci un valore valido!');

	if (activeGoal) {
		await supabaseClient.from('user_goals').update({ is_active: false }).eq('id', activeGoal.id);
	}

	const { error } = await supabaseClient.from('user_goals').insert({
		user_id: currentUser.id,
		metric, period,
		target_value: target,
		is_active: true
	});

	if (error) { alert("Errore nel salvataggio dell'obiettivo."); return; }
	showMessage('🎯 Obiettivo impostato!');
	await loadGoal();
}

async function removeGoal() {
	if (!activeGoal) return;
	if (!confirm("Rimuovere l'obiettivo attuale?")) return;

	const { error } = await supabaseClient.from('user_goals').update({ is_active: false }).eq('id', activeGoal.id);
	if (error) { alert('Errore nella rimozione.'); return; }

	activeGoal = null;
	showMessage('🗑️ Obiettivo rimosso');
	renderGoalCard();
}

function getMonthKey(date) {
	const d = new Date(date);
	return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

// ========== RIEPILOGO ANNUALE ("WRAPPED") ==========
function openWrapped(year) {
	const years = [...new Set(smokes.map(s => new Date(s.date).getFullYear()))].sort((a, b) => b - a);
	if (years.length === 0) return alert('Non ci sono ancora dati per generare un riepilogo.');
	const targetYear = year || years[0];
	renderWrapped(targetYear, years);
	document.getElementById('wrappedModal').style.display = 'flex';
}

function closeWrapped() {
	document.getElementById('wrappedModal').style.display = 'none';
}

function renderWrapped(year, years) {
	const yearSmokes = smokes.filter(s => new Date(s.date).getFullYear() === year);
	document.getElementById('wrappedTitle').textContent = `🎉 Il tuo ${year}`;

	const selector = years.length > 1 ? `
		<select onchange="openWrapped(parseInt(this.value))" style="margin-top:0; margin-bottom:15px;">
			${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
		</select>
	` : '';

	if (yearSmokes.length === 0) {
		document.getElementById('wrappedContent').innerHTML = `${selector}<p style="text-align:center; color:var(--color-text-muted);">Nessun dato per il ${year}.</p>`;
		return;
	}

	const totalGrams = yearSmokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const totalSessions = yearSmokes.length;
	const uniqueDays = new Set(yearSmokes.map(s => s.date)).size;

	const dayNames = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
	const dayCounts = [0, 0, 0, 0, 0, 0, 0];
	yearSmokes.forEach(s => dayCounts[new Date(s.date).getDay()]++);
	const topDayIdx = dayCounts.indexOf(Math.max(...dayCounts));

	const placeCounts = {};
	yearSmokes.forEach(s => { if (s.location_name) placeCounts[s.location_name] = (placeCounts[s.location_name] || 0) + 1; });
	const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];

	const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
	const monthCounts = Array(12).fill(0);
	yearSmokes.forEach(s => monthCounts[new Date(s.date).getMonth()]++);
	const topMonthIdx = monthCounts.indexOf(Math.max(...monthCounts));

	const sharedCount = yearSmokes.filter(s => Array.isArray(s.shared_with) && s.shared_with.length > 0).length;

	const yearPurchases = purchases.filter(p => p.date && new Date(p.date).getFullYear() === year && p.price);
	const totalSpent = yearPurchases.reduce((sum, p) => sum + parseFloat(p.price), 0);

	document.getElementById('wrappedContent').innerHTML = `
		${selector}
		<div class="stat-grid" style="margin-bottom:15px;">
			<div class="stat-box"><big>${totalSessions}</big><small>Sessioni</small></div>
			<div class="stat-box"><big>${totalGrams.toFixed(1)}</big><small>Grammi</small></div>
			<div class="stat-box"><big>${uniqueDays}</big><small>Giorni attivi</small></div>
			<div class="stat-box"><big>${sharedCount}</big><small>Condivise</small></div>
		</div>
		<div style="font-size:13px; line-height:2;">
			<div>📅 Giorno preferito: <strong>${dayNames[topDayIdx]}</strong></div>
			<div>🌟 Mese più attivo: <strong>${monthNames[topMonthIdx]}</strong> (${monthCounts[topMonthIdx]} sessioni)</div>
			${topPlace ? `<div>📍 Posto preferito: <strong>${topPlace[0]}</strong> (${topPlace[1]}x)</div>` : ''}
			${totalSpent > 0 ? `<div>💰 Speso (registrato): <strong>€${totalSpent.toFixed(2)}</strong></div>` : ''}
		</div>
	`;
}

// ========== INSIGHT AUTOMATICI ==========
function renderInsights() {
	const el = document.getElementById('insightsList');
	if (!el) return;

	if (smokes.length < 5) {
		el.innerHTML = '<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Servono più dati per generare insight (almeno 5 sessioni).</p>';
		return;
	}

	const insights = [];
	const dayNames = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
	const dayCounts = [0, 0, 0, 0, 0, 0, 0];
	const hourSlots = { Notte: 0, Mattina: 0, Pomeriggio: 0, Sera: 0 };
	const placeCounts = {};

	smokes.forEach(s => {
		const d = new Date(s.date);
		dayCounts[d.getDay()]++;
		if (s.time && typeof s.time === 'string') {
			const h = parseInt(s.time.split(':')[0]);
			if (h >= 0 && h < 6) hourSlots.Notte++;
			else if (h < 12) hourSlots.Mattina++;
			else if (h < 18) hourSlots.Pomeriggio++;
			else hourSlots.Sera++;
		}
		if (s.location_name) placeCounts[s.location_name] = (placeCounts[s.location_name] || 0) + 1;
	});

	const topDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
	if (dayCounts[topDayIdx] > 0) {
		const pct = Math.round((dayCounts[topDayIdx] / smokes.length) * 100);
		insights.push(`📅 <strong>${dayNames[topDayIdx]}</strong> è il tuo giorno più attivo (${pct}% delle sessioni).`);
	}

	const topSlot = Object.entries(hourSlots).sort((a, b) => b[1] - a[1])[0];
	if (topSlot && topSlot[1] > 0) {
		const pct = Math.round((topSlot[1] / smokes.length) * 100);
		const slotLabel = { Notte: 'di notte 🌙', Mattina: 'di mattina ☀️', Pomeriggio: 'nel pomeriggio 🌤️', Sera: 'di sera 🌆' }[topSlot[0]];
		insights.push(`⏰ Fumi soprattutto <strong>${slotLabel}</strong> (${pct}% delle sessioni).`);
	}

	const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];
	if (topPlace) {
		insights.push(`📍 Il posto dove fumi più spesso è <strong>${topPlace[0]}</strong> (${topPlace[1]} sessioni).`);
	}

	const now = new Date();
	const currentMonthKey = getMonthKey(now);
	const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const lastMonthKey = getMonthKey(lastMonthDate);
	const currentCount = smokes.filter(s => getMonthKey(s.date) === currentMonthKey).length;
	const lastCount = smokes.filter(s => getMonthKey(s.date) === lastMonthKey).length;
	if (lastCount > 0) {
		const diffPct = Math.round(((currentCount - lastCount) / lastCount) * 100);
		if (Math.abs(diffPct) >= 10) {
			insights.push(diffPct > 0
				? `📈 Questo mese hai fumato il <strong>${diffPct}% in più</strong> rispetto al mese scorso.`
				: `📉 Questo mese hai fumato il <strong>${Math.abs(diffPct)}% in meno</strong> rispetto al mese scorso.`);
		}
	}

	const totalGrams = smokes.reduce((sum, s) => sum + personalGrams(s), 0);
	const avgPerSession = totalGrams / smokes.length;
	insights.push(`⚖️ In media consumi <strong>${avgPerSession.toFixed(2)}g</strong> a sessione.`);

	el.innerHTML = insights.map(i => `
		<div style="padding:10px 12px; margin-bottom:8px; border-radius:10px; background:rgba(var(--overlay-rgb),0.05); font-size:13px; line-height:1.5;">${i}</div>
	`).join('');
}

// ========== CONTESTO & UMORE ==========
const CONTEXT_TAG_LABELS = { relax: '😌 Relax', social: '👥 Social', creativo: '🎨 Creativo', sonno: '😴 Sonno' };

function renderContextStats() {
	const el = document.getElementById('contextStatsList');
	if (!el) return;

	const tagged = smokes.filter(s => s.context_tag);
	if (tagged.length === 0) {
		el.innerHTML = '<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Nessuna sessione taggata ancora. Scegli un contesto quando registri una sessione.</p>';
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
		const avgMood = data.moodCount > 0 ? (data.moodSum / data.moodCount).toFixed(1) : null;
		return `
			<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(var(--overlay-rgb),0.05); border-radius:10px; margin-bottom:6px;">
				<span style="font-size:13px; font-weight:600;">${CONTEXT_TAG_LABELS[tag] || tag}</span>
				<span style="font-size:12px; color:var(--color-text-muted);">${data.count} sessioni${avgMood ? ` · umore medio ${avgMood}/5` : ''}</span>
			</div>
		`;
	}).join('');
}

function renderPeriodComparison() {
	const el = document.getElementById('periodComparison');
	if (!el) return;

	const now = new Date();
	const currentMonthKey = getMonthKey(now);
	const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const lastMonthKey = getMonthKey(lastMonthDate);

	const currentSmokes = smokes.filter(s => getMonthKey(s.date) === currentMonthKey);
	const lastSmokes = smokes.filter(s => getMonthKey(s.date) === lastMonthKey);

	const currentCount = currentSmokes.length;
	const lastCount = lastSmokes.length;

	const currentGrams = currentSmokes.reduce((sum, s) => sum + (s.my_fumo_grams ?? s.fumo_grams ?? 0) + (s.my_erba_grams ?? s.erba_grams ?? 0), 0);
	const lastGrams = lastSmokes.reduce((sum, s) => sum + (s.my_fumo_grams ?? s.fumo_grams ?? 0) + (s.my_erba_grams ?? s.erba_grams ?? 0), 0);

	function renderDiff(current, last) {
		if (last === 0 && current === 0) return `<span style="color:var(--color-text-muted); font-size:12px;">Nessun dato</span>`;
		if (last === 0) return `<span style="color:var(--primary); font-size:12px; font-weight:600;">▲ Nuovo questo mese</span>`;
		const pct = ((current - last) / last) * 100;
		const isSame = Math.abs(pct) < 0.5;
		const isUp = pct > 0;
		const color = isSame ? 'var(--color-text-muted)' : (isUp ? '#FF9800' : '#2196F3');
		const arrow = isSame ? '→' : (isUp ? '▲' : '▼');
		return `<span style="color:${color}; font-size:12px; font-weight:600;">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
	}

	function renderRow(label, current, last, suffix) {
		const displayVal = suffix === 'g' ? current.toFixed(1) : current;
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
		${renderRow('Sessioni', currentCount, lastCount, '')}
		${renderRow('Grammi totali', currentGrams, lastGrams, 'g')}
		<p style="font-size:11px; color:var(--color-text-muted); margin-top:8px; text-align:center;">Mese scorso: ${lastCount} sessioni · ${lastGrams.toFixed(1)}g</p>
	`;
}

async function startBreak() {
	const today = new Date().toISOString().split('T')[0];
	const { error } = await supabaseClient.from('tolerance_breaks').insert({
		user_id: currentUser.id,
		start_date: today,
		is_active: true
	});

	if (error) { alert('Errore nell\'avvio della pausa.'); return; }
	showMessage('💤 Pausa iniziata, in bocca al lupo!');
	await loadBreaks();
}

async function endBreak() {
	if (!activeBreak) return;
	if (!confirm('Vuoi terminare la pausa attuale?')) return;

	const today = new Date().toISOString().split('T')[0];
	const { error } = await supabaseClient
		.from('tolerance_breaks')
		.update({ is_active: false, end_date: today })
		.eq('id', activeBreak.id);

	if (error) { alert('Errore nella chiusura della pausa.'); return; }
	showMessage('✅ Pausa conclusa, ottimo lavoro!');
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

	const today = new Date().toISOString().split('T')[0];
	const hasToday = smokes.some(s => s.date === today);

	if (hasToday) {
		banner.style.display = 'none';
		return;
	}

	const streak = calculateStreak();
	if (streak >= 1) {
		textEl.textContent = `🔥 Rischi di perdere lo streak di ${streak} giorni! Non hai ancora segnato oggi.`;
	} else {
		textEl.textContent = `📝 Non hai ancora segnato nulla oggi.`;
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
		.order('created_at', { ascending: false })
		.limit(30);

	if (error) { console.error('Errore notifiche:', error); return; }

	notifications = data || [];
	renderNotifications();
	updateNotifBadge();
}

function renderNotifications() {
	const list = document.getElementById('notifList');
	if (!list) return;

	if (notifications.length === 0) {
		list.innerHTML = '<p style="padding:15px; text-align:center; color:var(--color-text-muted); font-size:13px;">Nessuna notifica.</p>';
		return;
	}

	list.innerHTML = notifications.map(n => `
		<div style="padding:12px 15px; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); background:${n.read ? 'transparent' : 'rgba(76,175,80,0.08)'};">
			<p style="margin:0; font-size:13px; color:var(--color-text);">${n.message}</p>
			<small style="color:var(--color-text-muted);">${formatNotifTime(n.created_at)}</small>
		</div>
	`).join('');
}

function formatNotifTime(iso) {
	const d = new Date(iso);
	const now = new Date();
	const diffMin = Math.floor((now - d) / 60000);
	if (diffMin < 1) return 'Adesso';
	if (diffMin < 60) return `${diffMin} min fa`;
	const diffH = Math.floor(diffMin / 60);
	if (diffH < 24) return `${diffH} h fa`;
	return d.toLocaleDateString('it-IT');
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

async function toggleNotifications() {
	const panel = document.getElementById('notifPanel');
	const menu = document.getElementById('menu');
	if (menu) menu.classList.remove('active');

	const isOpening = !panel.classList.contains('active');
	panel.classList.toggle('active');

	if (isOpening) {
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
			showMessage('🔔 ' + payload.new.message);
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
		alert('Errore nel salvataggio delle preferenze.');
	} else {
		showMessage('✅ Preferenze salvate!');
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
		statusEl.textContent = '❌ Il tuo browser non supporta le notifiche push.';
		return;
	}

	try {
		statusEl.textContent = '⏳ Attivazione in corso...';

		const registration = await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;

		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			statusEl.textContent = '❌ Permesso negato. Abilita le notifiche dalle impostazioni del browser.';
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
			statusEl.textContent = '❌ Errore nel salvataggio della sottoscrizione.';
			console.error(error);
			return;
		}

		statusEl.textContent = '✅ Notifiche push attivate su questo dispositivo!';
		loadPushDevices();
	} catch (err) {
		console.error(err);
		statusEl.textContent = '❌ Errore durante l\'attivazione.';
	}
}

// ========== STATO BACKUP AUTOMATICI (solo metadati, mai il contenuto) ==========
async function loadBackupStatus() {
	const el = document.getElementById('backupStatusList');
	if (!el) return;
	el.innerHTML = '<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">Caricamento...</p>';

	try {
		const { data, error } = await supabaseClient.functions.invoke('list-backups');
		if (error || !data?.ok) throw error || new Error('Risposta non valida');

		if (!data.files || data.files.length === 0) {
			el.innerHTML = '<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">Nessun backup automatico ancora eseguito.</p>';
			return;
		}

		el.innerHTML = data.files.slice(0, 5).map(f => `
			<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(var(--overlay-rgb),0.06); font-size:12px;">
				<span>${f.name}</span>
				<span style="color:var(--color-text-muted);">${new Date(f.created_at).toLocaleDateString('it-IT')}</span>
			</div>
		`).join('');
	} catch (err) {
		console.error('Errore stato backup:', err);
		el.innerHTML = '<p style="font-size:12px; color:var(--color-text-muted); text-align:center;">Impossibile verificare lo stato dei backup.</p>';
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
		el.innerHTML = '<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Nessun dispositivo con notifiche attive.</p>';
		return;
	}

	const currentEndpoint = await getCurrentPushEndpoint();

	el.innerHTML = devices.map(d => {
		const isThis = d.endpoint === currentEndpoint;
		const dateStr = new Date(d.created_at).toLocaleDateString('it-IT');
		return `
			<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(var(--overlay-rgb),0.05); border-radius:10px; margin-bottom:6px;">
				<div>
					<span style="font-size:13px; font-weight:600;">📱 Dispositivo${isThis ? ' <span style="color:var(--primary); font-size:11px;">(questo)</span>' : ''}</span><br>
					<small style="color:var(--color-text-muted);">Attivato il ${dateStr}</small>
				</div>
				<button onclick="revokePushDevice(${d.id})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">🗑️</button>
			</div>
		`;
	}).join('');
}

async function revokePushDevice(id) {
	if (!confirm('Disattivare le notifiche push per questo dispositivo?')) return;
	const { error } = await supabaseClient.from('push_subscriptions').delete().eq('id', id);
	if (error) { alert('Errore nella rimozione.'); return; }
	showMessage('🗑️ Dispositivo rimosso');
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
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysWindow);
	const cutoffStr = cutoff.toISOString().split('T')[0];

	const recentGrams = smokes
		.filter(s => !s.not_mine && s.date >= cutoffStr)
		.reduce((sum, s) => sum + (type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0)), 0);

	return recentGrams / daysWindow;
}

function getTotalRemaining(type) {
	return getOpenPurchasesFIFO(type).reduce((sum, p) => sum + gramsRemainingForPurchase(p), 0);
}

function renderStockPrediction(type) {
	const remaining = getTotalRemaining(type);
	if (remaining <= 0) return '';

	const dailyRate = computeDailyRate(type);
	if (dailyRate <= 0) {
		return `<p style="font-size:12px; color:var(--color-text-muted); margin-top:10px; text-align:center;">⏳ Consumo troppo basso negli ultimi 14gg per stimare la durata</p>`;
	}

	const daysLeft = Math.round(remaining / dailyRate);
	const exhaustDate = new Date();
	exhaustDate.setDate(exhaustDate.getDate() + daysLeft);
	const dateStr = exhaustDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

	const urgencyColor = daysLeft > 7 ? '#4CAF50' : daysLeft > 3 ? '#FF9800' : '#f44336';

	return `
		<div style="background:rgba(var(--overlay-rgb),0.05); border-radius:10px; padding:10px; margin-top:10px; text-align:center;">
			<span style="font-size:13px; color:${urgencyColor}; font-weight:600;">
				⏳ Al ritmo attuale, dura ancora ~${daysLeft} giorni (fino al ${dateStr})
			</span>
		</div>
	`;
}

// ========== RENDER PAGINA STOCK ==========
function renderStockPage() {
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

    if (openPurchases.length === 0) {
        displayEl.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Nessuna scorta attiva</p>`;
        if (closeBtn) closeBtn.style.display = 'none';
        return;
    }

    // Nascondi il vecchio tasto globale (ora è inline per acquisto)
    if (closeBtn) closeBtn.style.display = 'none';

    let html = '';

    openPurchases.forEach((p, idx) => {
        const isOldest = idx === 0;
        const consumed = gramsConsumedForPurchase(p);
        const remaining = gramsRemainingForPurchase(p);
        const pct = Math.min(100, Math.max(0, (remaining / parseFloat(p.grams)) * 100));
        const priceStr = p.price ? ` · €${p.price}` : '';
        const barColor = pct > 50 ? '#4CAF50' : pct > 20 ? '#FF9800' : '#f44336';

        const oldestLabel = isOldest && openPurchases.length > 1
            ? `<span style="background:var(--warning-bg); color:var(--warning-text); font-size:11px; padding:2px 8px; border-radius:20px; margin-left:6px;">In uso</span>`
            : '';

        html += `
            <div style="background:${colorLight}; border-radius:12px; padding:14px; margin-bottom:${idx < openPurchases.length-1 ? '12px' : '0'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:13px; color:var(--color-text-secondary);">
                        ${emoji} Acquisto del ${p.date.split('-').reverse().join('/')}${oldestLabel}
                    </span>
                    <span style="font-weight:700; color:${color};">${p.grams}g${priceStr}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:13px; color:var(--color-text-secondary);">Consumati</span>
                    <span style="font-weight:600; color:var(--color-text-secondary);">${consumed.toFixed(2)}g</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:14px; font-weight:700; color:${color};">Rimanenti</span>
                    <span style="font-size:18px; font-weight:800; color:${color};">${remaining.toFixed(2)}g</span>
                </div>
                <div style="background:rgba(var(--overlay-rgb),0.12); border-radius:8px; height:10px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:8px; transition: width 0.5s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                    <span style="font-size:11px; color:var(--color-text-muted);">${pct.toFixed(0)}% rimanente</span>
                    ${isOldest ? `<button onclick="closeStock('${type}', ${p.id})" style="background:none; border:none; color:var(--danger); font-size:12px; font-weight:bold; cursor:pointer; text-decoration:underline; padding:0;">⚠️ Ho finito questa scorta</button>` : ''}
                </div>
            </div>
        `;
    });

    html += renderStockPrediction(type);
    displayEl.innerHTML = html;
}



// ========== MINI WIDGET PAGINA AGGIUNGI ==========
function renderMiniWidget() {
    const widget = document.getElementById('miniStockWidget');
    if (!widget) return;
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

    // FUMO — scala dal più vecchio
    if (openFumo.length > 0) {
        const oldest = openFumo[0];
        const remaining = gramsRemainingForPurchase(oldest);
        const pct = Math.min(100, (remaining / parseFloat(oldest.grams)) * 100);
        document.getElementById('miniFumoGrams').textContent = remaining.toFixed(2) + 'g';
        document.getElementById('miniFumoBar').style.width = pct + '%';
    } else {
        document.getElementById('miniFumoGrams').textContent = '–';
        document.getElementById('miniFumoBar').style.width = '0%';
    }

    // ERBA — scala dal più vecchio
    if (openErba.length > 0) {
        const oldest = openErba[0];
        const remaining = gramsRemainingForPurchase(oldest);
        const pct = Math.min(100, (remaining / parseFloat(oldest.grams)) * 100);
        document.getElementById('miniErbaGrams').textContent = remaining.toFixed(2) + 'g';
        document.getElementById('miniErbaBar').style.width = pct + '%';
    } else {
        document.getElementById('miniErbaGrams').textContent = '–';
        document.getElementById('miniErbaBar').style.width = '0%';
    }
}

// ========== STORICO ACQUISTI ==========
function renderPurchaseHistory() {
    const el = document.getElementById('purchaseHistory');
    if (!el) return;

    if (purchases.length === 0) {
        el.innerHTML = '<p style="text-align:center; color:var(--color-text-muted); font-size:13px;">Nessun acquisto registrato.</p>';
        return;
    }

    el.innerHTML = purchases.map(p => {
        const emoji = p.type === 'fumo' ? '🍫' : '🍃';
        const label = p.type === 'fumo' ? 'Fumo' : 'Erba';
        const priceStr = p.price ? ` · <span style="color:var(--warning);">€${p.price}</span>` : '';

        const statusStr = p.is_closed
            ? `<span style="background:rgba(var(--overlay-rgb),0.08); color:var(--color-text-muted); font-size:11px; padding:2px 8px; border-radius:20px;">Chiusa</span>`
            : `<span style="background:rgba(76,175,80,0.12); color:var(--primary); font-size:11px; padding:2px 8px; border-radius:20px;">Attiva</span>`;

        let consumedStr = '–';
        let barHtml = '';

        if (!p.is_closed) {
            const consumed = gramsConsumedForPurchase(p);
            const remaining = gramsRemainingForPurchase(p);
            const pct = Math.min(100, Math.max(0, (remaining / parseFloat(p.grams)) * 100));
            const barColor = pct > 50 ? '#4CAF50' : pct > 20 ? '#FF9800' : '#f44336';
            consumedStr = `${consumed.toFixed(2)}g consumati · ${remaining.toFixed(2)}g rimanenti`;
            barHtml = `
                <div style="background:rgba(var(--overlay-rgb),0.12); border-radius:6px; height:6px; overflow:hidden; margin-top:6px;">
                    <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:6px; transition: width 0.5s ease;"></div>
                </div>
            `;
        } else if (p.closed_at) {
            const days = Math.max(0, Math.round((new Date(p.closed_at) - new Date(p.date)) / 86400000));
            consumedStr = `Terminata il ${p.closed_at.split('-').reverse().join('/')} · durata: ${days} giorno${days === 1 ? '' : 'i'}`;
        }

        return `
            <div style="padding:12px; border-bottom:1px solid rgba(var(--overlay-rgb),0.07);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-weight:700;">${emoji} ${label}</span>
                        ${statusStr}<br>
                        <small style="color:var(--color-text-muted);">${p.date.split('-').reverse().join('/')} · ${p.grams}g${priceStr}</small><br>
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
        `Registra acquisto ${type === 'fumo' ? '🍫 Fumo' : '🍃 Erba'}`;
    document.getElementById('buyGrams').value = '';
    document.getElementById('buyPrice').value = '';
    document.getElementById('buyDate').value = new Date().toISOString().split('T')[0];
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

    if (!grams || grams <= 0) return alert('Inserisci una quantità valida!');
    if (!date) return alert('Inserisci una data!');

    // Se c'è già una scorta attiva dello stesso tipo, chiedi conferma
    const existing = currentBuyType === 'fumo' ? activeFumoStock : activeErbaStock;
    if (existing) {
        if (!confirm(`Hai già una scorta di ${currentBuyType} attiva. Vuoi aggiungere un nuovo acquisto separato?`)) return;
    }

    const { error } = await supabaseClient.from('purchases').insert({
        user_id: currentUser.id,
        type: currentBuyType,
        grams,
        price,
        date,
        is_closed: false
    });

    if (error) { alert('Errore nel salvataggio.'); return; }

    closeBuyModal();
    showMessage('✅ Acquisto registrato!');
    await loadPurchases();
}

async function deletePurchase(id) {
    if (!confirm('Vuoi eliminare questo acquisto?')) return;
    const { error } = await supabaseClient.from('purchases').delete().eq('id', id);
    if (!error) { showMessage('🗑️ Acquisto eliminato'); await loadPurchases(); }
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

    let msg = '';
    if (diff > 0) {
        msg = `Hai registrato <strong>${consumed.toFixed(2)}g</strong> di ${type} nelle sessioni,
               ma ne avevi comprati solo <strong>${stock.grams}g</strong>.<br><br>
               Differenza: <strong style="color:var(--danger);">+${absDiff.toFixed(2)}g in eccesso</strong>.<br><br>
               Come vuoi procedere?`;
    } else {
        msg = `Hai registrato <strong>${consumed.toFixed(2)}g</strong> di ${type},
               ma ne avevi comprati <strong>${stock.grams}g</strong>.<br><br>
               Differenza: <strong style="color:var(--warning);">${absDiff.toFixed(2)}g non contabilizzati</strong>.<br><br>
               Come vuoi procedere?`;
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

// Scala tutte le sessioni proporzionalmente
async function fixProportional() {
    if (!pendingCloseStock) return;
    const { type, stock, consumed } = pendingCloseStock;

    if (consumed === 0) { confirmCloseStock(); return; }

    const factor = stock.grams / consumed; // es. 0.85 se hai segnato troppo

    for (const s of sessionsToFix) {
        const oldGram = type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0);
        const newGram = parseFloat((oldGram * factor).toFixed(2));
        const newTotal = parseFloat(((s.grams || 0) - oldGram + newGram).toFixed(2));

        const updateObj = type === 'fumo'
            ? { fumo_grams: newGram, grams: newTotal }
            : { erba_grams: newGram, grams: newTotal };

        await supabaseClient.from('smokes').update(updateObj).eq('id', s.id);
    }

    document.getElementById('discrepancyModal').style.display = 'none';
    showMessage('⚖️ Sessioni ricalcolate!');
    await loadData();
    confirmCloseStock();
}

// Mostra lista sessioni modificabili manualmente
function fixManual() {
    document.getElementById('discrepancyModal').style.display = 'none';
    const { type, stock } = pendingCloseStock;

    document.getElementById('manualFixHint').textContent =
        `Modifica i grammi di ${type} per ciascuna sessione del periodo. Totale acquistato: ${stock.grams}g`;

    const listEl = document.getElementById('manualFixList');
    listEl.innerHTML = sessionsToFix.map(s => {
        const gram = type === 'fumo' ? (s.fumo_grams || 0) : (s.erba_grams || 0);
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;
                        padding:10px; border-bottom:1px solid rgba(var(--overlay-rgb),0.07);">
                <div>
                    <span style="font-weight:600;">${s.date.split('-').reverse().join('/')}</span>
                    <span style="color:var(--color-text-muted); font-size:12px;"> ${s.time}</span><br>
                    <small style="color:var(--color-text-muted);">Totale sessione: ${s.grams}g</small>
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

    for (const input of inputs) {
        const id = input.dataset.id;
        const type = input.dataset.type;
        const oldTotal = parseFloat(input.dataset.total);
        const oldGram = parseFloat(input.dataset.old);
        const newGram = parseFloat(input.value) || 0;
        const newTotal = parseFloat((oldTotal - oldGram + newGram).toFixed(2));

        const updateObj = type === 'fumo'
            ? { fumo_grams: newGram, grams: newTotal }
            : { erba_grams: newGram, grams: newTotal };

        await supabaseClient.from('smokes').update(updateObj).eq('id', id);
    }

    closeManualFix();
    showMessage('✅ Sessioni corrette!');
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

    const { error } = await supabaseClient
        .from('purchases')
        .update({ is_closed: true, closed_at: new Date().toISOString().split('T')[0] })
        .eq('id', stock.id);

    if (error) { alert('Errore nella chiusura della scorta.'); return; }

    showMessage('✅ Scorta chiusa!');
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

	// ========== GESTIONE MENU DROPDOWN ==========

function toggleMenu() {
	const menu = document.getElementById('menu');
	menu.classList.toggle('active');
}

// Chiudi il menu quando clicchi su un bottone
document.addEventListener('DOMContentLoaded', function() {
	const menuButtons = document.querySelectorAll('#menu button');
	menuButtons.forEach(btn => {
		btn.addEventListener('click', function() {
			setTimeout(() => {
				document.getElementById('menu').classList.remove('active');
			}, 100);
		});
	});

	// Chiudi menu/notifiche se clicchi fuori
	document.addEventListener('click', function(event) {
		const menu = document.getElementById('menu');
		const hamburgerBtn = document.getElementById('hamburgerBtn');
		const notifPanel = document.getElementById('notifPanel');
		const notifBtn = document.getElementById('notifBtn');

		if (menu && hamburgerBtn && !menu.contains(event.target) && !hamburgerBtn.contains(event.target)) {
			menu.classList.remove('active');
		}
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
	checkAuth();