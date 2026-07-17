const { invoke } = window.__TAURI__.core;

let currentAccount = null;
let currentConfig = null;
let gameData = null;
let previousScreen = 'login';

function log(msg) {
    const el = document.getElementById('log-area');
    if (el) {
        el.innerHTML += msg + '\n';
        el.scrollTop = el.scrollHeight;
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
}

async function init() {
    currentConfig = await invoke('load_config');
    renderSavedAccounts();
    document.getElementById('version-select').value = currentConfig.minecraft_version || '1.21.1';
    document.getElementById('fabric-check').checked = currentConfig.use_fabric;
    showScreen('login');
}

function renderSavedAccounts() {
    const container = document.getElementById('saved-accounts');
    container.innerHTML = '';
    const accounts = currentConfig.accounts || [];

    if (accounts.length === 0) return;

    const title = document.createElement('div');
    title.className = 'label';
    title.textContent = 'Cuentas guardadas:';
    title.style.marginBottom = '8px';
    container.appendChild(title);

    accounts.forEach((acc, idx) => {
        const item = document.createElement('div');
        item.className = 'account-item';
        item.onclick = (e) => {
            if (e.target.classList.contains('account-delete')) return;
            selectAccount(acc);
        };

        const badge = document.createElement('span');
        badge.className = 'account-badge ' + (acc.type === 'premium' ? 'premium' : 'offline');
        badge.textContent = acc.type === 'premium' ? 'Premium' : 'Offline';

        const name = document.createElement('span');
        name.className = 'account-name';
        name.textContent = acc.name;

        const del = document.createElement('button');
        del.className = 'account-delete';
        del.textContent = '\u2715';
        del.onclick = async (e) => {
            e.stopPropagation();
            currentConfig.accounts.splice(idx, 1);
            if (currentConfig.selected_account === acc.name) {
                currentConfig.selected_account = null;
            }
            await invoke('save_config', { config: currentConfig });
            renderSavedAccounts();
        };

        item.appendChild(badge);
        item.appendChild(name);
        item.appendChild(del);
        container.appendChild(item);
    });
}

function selectAccount(acc) {
    currentAccount = acc;
    showMainScreen();
}

function showPremiumLogin() {
    showScreen('premium');
    invoke('get_microsoft_auth_url').then(url => {
        const link = document.getElementById('ms-auth-link');
        link.href = url;
        link.textContent = url;
    });
    document.getElementById('auth-code-input').value = '';
    document.getElementById('auth-error').textContent = '';
}

function showOfflineLogin() {
    showScreen('offline');
    document.getElementById('offline-name').value = 'Player';
}

async function doMicrosoftLogin() {
    const code = document.getElementById('auth-code-input').value.trim();
    if (!code) {
        document.getElementById('auth-error').textContent = 'Ingresa el codigo de autorizacion';
        return;
    }

    document.getElementById('auth-error').textContent = 'Conectando con Microsoft...';
    document.getElementById('auth-error').style.color = '#f39c12';

    try {
        const account = await invoke('login_microsoft', { authCode: code });
        addAccount(account);
        currentAccount = account;
        showMainScreen();
    } catch (e) {
        document.getElementById('auth-error').textContent = 'Error: ' + e;
        document.getElementById('auth-error').style.color = '#f85149';
    }
}

async function doOfflineLogin() {
    const name = document.getElementById('offline-name').value.trim();
    if (!name || name.length < 3 || name.length > 16) {
        alert('El nombre debe tener entre 3 y 16 caracteres');
        return;
    }
    try {
        const account = await invoke('login_offline', { username: name });
        addAccount(account);
        currentAccount = account;
        showMainScreen();
    } catch (e) {
        alert('Error: ' + e);
    }
}

async function addAccount(account) {
    currentConfig.accounts = currentConfig.accounts || [];
    currentConfig.accounts = currentConfig.accounts.filter(a => a.name !== account.name);
    currentConfig.accounts.push(account);
    currentConfig.selected_account = account.name;
    await invoke('save_config', { config: currentConfig });
}

function showMainScreen() {
    showScreen('main');
    const acc = currentAccount;
    const badgeClass = acc.type === 'premium' ? 'premium' : 'offline';
    const badgeLabel = acc.type === 'premium' ? 'Premium' : 'Offline';
    document.getElementById('account-display').innerHTML =
        `${acc.name} <span class="type-badge account-badge ${badgeClass}">${badgeLabel}</span>`;

    updateGameInfo();
}

function updateGameInfo() {
    const ver = document.getElementById('version-select').value;
    const fab = document.getElementById('fabric-check').checked;
    const fabricText = fab ? 'Fabric 0.18.3' : 'Vanilla';
    document.getElementById('game-info').textContent = `Minecraft ${ver} \u2022 ${fabricText} \u2022 Java Edition`;
}

document.getElementById('version-select').addEventListener('change', updateGameInfo);
document.getElementById('fabric-check').addEventListener('change', updateGameInfo);

async function startPlay() {
    if (!currentAccount) return;
    const btn = document.getElementById('play-btn');
    const ver = document.getElementById('version-select').value;
    const useFabric = document.getElementById('fabric-check').checked;

    btn.disabled = true;
    btn.textContent = 'Descargando...';

    const progressSection = document.getElementById('progress-section');
    progressSection.style.display = 'block';

    log(`Preparing Minecraft ${ver}...`);

    try {
        const result = await invoke('download_game', {
            versionId: ver,
            useFabric: useFabric,
            fabricLoaderVersion: currentConfig.fabric_loader_version || '0.18.3'
        });

        gameData = result;
        log('Downloads complete. Starting game...');
        updateProgress(100, 100, 'Minecraft started!');

        const pid = await invoke('launch_game', {
            account: currentAccount,
            gameData: gameData,
            config: currentConfig
        });

        log(`Game started (PID: ${pid})`);
        btn.textContent = 'JUGAR';
        btn.disabled = false;
    } catch (e) {
        log('Error: ' + e);
        btn.textContent = 'JUGAR';
        btn.disabled = false;
        alert('Error launching game:\n' + e + '\n\nMake sure Java is installed.');
    }
}

function updateProgress(downloaded, total, msg) {
    const bar = document.getElementById('progress-bar');
    const text = document.getElementById('progress-text');
    const pct = total > 0 ? (downloaded / total) * 100 : 0;
    bar.style.width = Math.min(pct, 100) + '%';
    text.textContent = msg || '';
}

function showSettings() {
    previousScreen = currentAccount ? 'main' : 'login';
    showScreen('settings');
    if (currentConfig) {
        document.getElementById('set-java').value = currentConfig.java_path || 'java';
        document.getElementById('set-memory').value = currentConfig.memory_mb || 2048;
        document.getElementById('set-width').value = currentConfig.width || 854;
        document.getElementById('set-height').value = currentConfig.height || 480;
        document.getElementById('set-fabric-ver').value = currentConfig.fabric_loader_version || '0.18.3';
        document.getElementById('set-fullscreen').checked = currentConfig.fullscreen || false;
    }
}

async function saveSettings() {
    currentConfig.java_path = document.getElementById('set-java').value.trim();
    currentConfig.memory_mb = parseInt(document.getElementById('set-memory').value) || 2048;
    currentConfig.width = parseInt(document.getElementById('set-width').value) || 854;
    currentConfig.height = parseInt(document.getElementById('set-height').value) || 480;
    currentConfig.fabric_loader_version = document.getElementById('set-fabric-ver').value.trim();
    currentConfig.fullscreen = document.getElementById('set-fullscreen').checked;

    try {
        await invoke('save_config', { config: currentConfig });
        alert('Configuracion guardada!');
    } catch (e) {
        alert('Error: ' + e);
    }
}

function goBackFromSettings() {
    if (currentAccount) {
        showMainScreen();
    } else {
        showScreen('login');
    }
}

function openModsFolder() {
    invoke('open_mods_folder').catch(e => alert('Error: ' + e));
}

init();
