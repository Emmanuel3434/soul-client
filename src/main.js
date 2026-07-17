const { invoke } = window.__TAURI__.core;

let currentAccount = null;
let currentConfig = null;
let gameData = null;
let instanceFilter = "all";
let openMenuId = null;
let playingInstanceId = null;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById("screen-" + id);
  if (el) el.classList.add("active");
}

function setMainView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const viewEl = document.getElementById("view-" + view);
  if (viewEl) viewEl.classList.add("active");
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (nav) nav.classList.add("active");

  if (view === "settings") fillSettingsForm();
  if (view === "account") renderAccountPanel();
}

function log(msg) {
  const el = document.getElementById("log-area");
  if (!el) return;
  el.hidden = false;
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

function ensureInstances() {
  if (!currentConfig.instances || currentConfig.instances.length === 0) {
    currentConfig.instances = [
      { id: "soul-fabric", name: "Soul Fabric", version: "1.21.1", use_fabric: true, whitelist: false, cover: "fabric" },
      { id: "vanilla-latest", name: "Vanilla Latest", version: "1.21.1", use_fabric: false, whitelist: false, cover: "vanilla" },
      { id: "modded-pack", name: "Modded Pack", version: "1.20.1", use_fabric: true, whitelist: true, cover: "modded" },
    ];
  }
}

async function init() {
  currentConfig = await invoke("load_config");
  ensureInstances();
  renderSavedAccounts();
  showScreen("login");
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) {
      closeAllMenus();
    }
  });
}

function renderSavedAccounts() {
  const container = document.getElementById("saved-accounts");
  container.innerHTML = "";
  const accounts = currentConfig.accounts || [];
  if (!accounts.length) return;

  accounts.forEach((acc, idx) => {
    const item = document.createElement("div");
    item.className = "account-item";
    item.onclick = (e) => {
      if (e.target.classList.contains("account-delete")) return;
      selectAccount(acc);
    };

    const badge = document.createElement("span");
    badge.className = "account-badge " + (acc.type === "premium" ? "premium" : "offline");
    badge.textContent = acc.type === "premium" ? "Premium" : "Offline";

    const name = document.createElement("span");
    name.className = "account-name";
    name.textContent = acc.name;

    const del = document.createElement("button");
    del.className = "account-delete";
    del.type = "button";
    del.textContent = "×";
    del.onclick = async (e) => {
      e.stopPropagation();
      currentConfig.accounts.splice(idx, 1);
      if (currentConfig.selected_account === acc.name) currentConfig.selected_account = null;
      await invoke("save_config", { config: currentConfig });
      renderSavedAccounts();
    };

    item.append(badge, name, del);
    container.appendChild(item);
  });
}

function selectAccount(acc) {
  currentAccount = acc;
  enterMain();
}

function showPremiumLogin() {
  showScreen("premium");
  invoke("get_microsoft_auth_url").then((url) => {
    const link = document.getElementById("ms-auth-link");
    link.href = url;
    link.textContent = url;
  });
  document.getElementById("auth-code-input").value = "";
  document.getElementById("auth-error").textContent = "";
}

function showOfflineLogin() {
  showScreen("offline");
  document.getElementById("offline-name").value = "";
  document.getElementById("offline-error").textContent = "";
  setTimeout(() => document.getElementById("offline-name").focus(), 50);
}

async function checkOfflineName() {
  const name = document.getElementById("offline-name").value.trim();
  const err = document.getElementById("offline-error");
  if (!name) {
    err.textContent = "";
    return;
  }
  if (name.length < 3) {
    err.textContent = "Mínimo 3 caracteres";
    return;
  }
  try {
    const taken = await invoke("is_username_taken", {
      username: name,
      existingAccounts: currentConfig.accounts || [],
    });
    err.textContent = taken
      ? "Ese nombre ya está en uso. Elige un nombre diferente."
      : "";
  } catch (_) {
    /* ignore live-check errors */
  }
}

async function doMicrosoftLogin() {
  const code = document.getElementById("auth-code-input").value.trim();
  const err = document.getElementById("auth-error");
  if (!code) {
    err.textContent = "Ingresa el código de autorización";
    return;
  }
  err.style.color = "#f0c674";
  err.textContent = "Conectando con Microsoft...";
  try {
    const account = await invoke("login_microsoft", { authCode: code });
    await addAccount(account);
    currentAccount = account;
    enterMain();
  } catch (e) {
    err.style.color = "";
    err.textContent = "Error: " + e;
  }
}

async function doOfflineLogin() {
  const name = document.getElementById("offline-name").value.trim();
  const err = document.getElementById("offline-error");
  err.textContent = "";

  if (!name || name.length < 3 || name.length > 16) {
    err.textContent = "El nombre debe tener entre 3 y 16 caracteres";
    return;
  }

  const accounts = currentConfig.accounts || [];
  try {
    const taken = await invoke("is_username_taken", {
      username: name,
      existingAccounts: accounts,
    });
    if (taken) {
      err.textContent = "Ese nombre ya está en uso. Elige un nombre diferente.";
      return;
    }

    const account = await invoke("login_offline", {
      username: name,
      existingAccounts: accounts,
    });
    await addAccount(account);
    currentAccount = account;
    enterMain();
  } catch (e) {
    err.textContent = String(e);
  }
}

async function addAccount(account) {
  currentConfig.accounts = currentConfig.accounts || [];
  // Premium can update token for same name; offline uniqueness already enforced
  if (account.type === "premium") {
    currentConfig.accounts = currentConfig.accounts.filter(
      (a) => a.name.toLowerCase() !== account.name.toLowerCase()
    );
  }
  currentConfig.accounts.push(account);
  currentConfig.selected_account = account.name;
  await invoke("save_config", { config: currentConfig });
}

function enterMain() {
  showScreen("main");
  setMainView("home");
  updateAvatar();
  renderInstances();
  renderAccountPanel();
}

function updateAvatar() {
  const initials = (currentAccount?.name || "SC").slice(0, 2).toUpperCase();
  document.getElementById("avatar-initials").textContent = initials;
}

function renderAccountPanel() {
  const panel = document.getElementById("account-panel");
  if (!currentAccount) {
    panel.innerHTML = "<p class='empty-state'>No hay sesión activa.</p>";
    return;
  }
  const typeLabel = currentAccount.type === "premium" ? "Premium (Microsoft)" : "No premium (offline)";
  panel.innerHTML = `
    <div class="name">${escapeHtml(currentAccount.name)}</div>
    <div class="meta">${typeLabel}</div>
    <div class="meta" style="margin-top:8px">ID: ${escapeHtml(currentAccount.id)}</div>
  `;
}

function logoutToLogin() {
  currentAccount = null;
  renderSavedAccounts();
  showScreen("login");
}

function setInstanceFilter(filter) {
  instanceFilter = filter;
  document.querySelectorAll(".filter-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.filter === filter);
  });
  renderInstances();
}

function renderInstances() {
  ensureInstances();
  const grid = document.getElementById("instances-grid");
  const q = (document.getElementById("instance-search").value || "").trim().toLowerCase();
  let list = [...(currentConfig.instances || [])];

  if (instanceFilter === "whitelist") list = list.filter((i) => i.whitelist);
  if (instanceFilter === "no-whitelist") list = list.filter((i) => !i.whitelist);
  if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.version.includes(q));

  if (!list.length) {
    grid.innerHTML = `<p class="empty-state">No hay instancias que coincidan.</p>`;
    return;
  }

  grid.innerHTML = list
    .map((inst, idx) => {
      const loader = inst.use_fabric ? "Fabric" : "Vanilla";
      const cover = inst.cover || "default";
      const delay = Math.min(idx * 40, 200);
      return `
        <article class="instance-card" style="animation-delay:${delay}ms" data-id="${escapeAttr(inst.id)}">
          <div class="instance-cover ${escapeAttr(cover)}"></div>
          <div class="instance-body">
            <h3 class="instance-title">${escapeHtml(inst.name)}</h3>
            <p class="instance-meta">${escapeHtml(inst.version)} · ${loader}</p>
            ${inst.whitelist ? '<span class="instance-tag">Whitelist</span>' : ""}
            <div class="instance-actions">
              <button class="btn-play" type="button" ${playingInstanceId ? "disabled" : ""} onclick="playInstance('${escapeAttr(inst.id)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Jugar
              </button>
              <div class="menu-wrap">
                <button class="btn-kebab" type="button" aria-label="Más opciones" onclick="toggleMenu(event, '${escapeAttr(inst.id)}')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
                <div class="context-menu" id="menu-${escapeAttr(inst.id)}" hidden>
                  <button type="button" onclick="openModsFolder()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h6l2 2h10v10H3z"/></svg>
                    Ver carpeta
                  </button>
                  <button type="button" onclick="editInstance('${escapeAttr(inst.id)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    Editar instancia
                  </button>
                  <button type="button" onclick="setMainView('settings')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1"/></svg>
                    Ajustes
                  </button>
                  <button type="button" class="danger" onclick="deleteInstance('${escapeAttr(inst.id)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-1 0v14H9V6"/></svg>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function toggleMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById("menu-" + id);
  const wasOpen = openMenuId === id && menu && !menu.hidden;
  closeAllMenus();
  if (!wasOpen && menu) {
    menu.hidden = false;
    openMenuId = id;
  }
}

function closeAllMenus() {
  document.querySelectorAll(".context-menu").forEach((m) => (m.hidden = true));
  openMenuId = null;
}

async function playInstance(id) {
  if (!currentAccount || playingInstanceId) return;
  const inst = (currentConfig.instances || []).find((i) => i.id === id);
  if (!inst) return;

  playingInstanceId = id;
  renderInstances();

  const progress = document.getElementById("progress-section");
  progress.hidden = false;
  document.getElementById("progress-text").textContent = `Preparando ${inst.name}...`;
  document.getElementById("progress-bar").style.width = "15%";
  log(`Preparando Minecraft ${inst.version}...`);

  try {
    currentConfig.minecraft_version = inst.version;
    currentConfig.use_fabric = !!inst.use_fabric;
    await invoke("save_config", { config: currentConfig });

    const result = await invoke("download_game", {
      versionId: inst.version,
      useFabric: !!inst.use_fabric,
      fabricLoaderVersion: currentConfig.fabric_loader_version || "0.18.3",
    });

    gameData = result;
    document.getElementById("progress-bar").style.width = "100%";
    document.getElementById("progress-text").textContent = "Iniciando juego...";
    log("Descargas listas. Iniciando...");

    const pid = await invoke("launch_game", {
      account: currentAccount,
      gameData,
      config: currentConfig,
    });
    log(`Juego iniciado (PID: ${pid})`);
    document.getElementById("progress-text").textContent = "Minecraft en ejecución";
  } catch (e) {
    log("Error: " + e);
    document.getElementById("progress-text").textContent = "Error al iniciar";
    alert("Error al lanzar el juego:\n" + e + "\n\nAsegúrate de tener Java instalado.");
  } finally {
    playingInstanceId = null;
    renderInstances();
  }
}

function openAddInstance() {
  document.getElementById("modal-overlay").hidden = false;
  document.getElementById("new-inst-name").value = "";
  document.getElementById("new-inst-version").value = "1.21.1";
  document.getElementById("new-inst-fabric").checked = true;
  document.getElementById("new-inst-whitelist").checked = false;
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
}

async function createInstance() {
  const name = document.getElementById("new-inst-name").value.trim();
  if (!name) {
    alert("Escribe un nombre para la instancia");
    return;
  }
  const version = document.getElementById("new-inst-version").value;
  const useFabric = document.getElementById("new-inst-fabric").checked;
  const whitelist = document.getElementById("new-inst-whitelist").checked;
  const cover = useFabric ? "fabric" : "vanilla";

  ensureInstances();
  currentConfig.instances.push({
    id: "inst-" + Date.now(),
    name,
    version,
    use_fabric: useFabric,
    whitelist,
    cover,
  });
  await invoke("save_config", { config: currentConfig });
  closeModal();
  renderInstances();
}

async function deleteInstance(id) {
  closeAllMenus();
  if (!confirm("¿Eliminar esta instancia?")) return;
  currentConfig.instances = (currentConfig.instances || []).filter((i) => i.id !== id);
  await invoke("save_config", { config: currentConfig });
  renderInstances();
}

function editInstance(id) {
  closeAllMenus();
  const inst = (currentConfig.instances || []).find((i) => i.id === id);
  if (!inst) return;
  const name = prompt("Nombre de la instancia", inst.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  inst.name = trimmed;
  invoke("save_config", { config: currentConfig }).then(renderInstances);
}

function fillSettingsForm() {
  if (!currentConfig) return;
  document.getElementById("set-java").value = currentConfig.java_path || "java";
  document.getElementById("set-memory").value = currentConfig.memory_mb || 2048;
  document.getElementById("set-width").value = currentConfig.width || 854;
  document.getElementById("set-height").value = currentConfig.height || 480;
  document.getElementById("set-fabric-ver").value = currentConfig.fabric_loader_version || "0.18.3";
  document.getElementById("set-fullscreen").checked = !!currentConfig.fullscreen;
}

async function saveSettings() {
  currentConfig.java_path = document.getElementById("set-java").value.trim();
  currentConfig.memory_mb = parseInt(document.getElementById("set-memory").value, 10) || 2048;
  currentConfig.width = parseInt(document.getElementById("set-width").value, 10) || 854;
  currentConfig.height = parseInt(document.getElementById("set-height").value, 10) || 480;
  currentConfig.fabric_loader_version = document.getElementById("set-fabric-ver").value.trim();
  currentConfig.fullscreen = document.getElementById("set-fullscreen").checked;
  try {
    await invoke("save_config", { config: currentConfig });
    alert("Ajustes guardados");
  } catch (e) {
    alert("Error: " + e);
  }
}

function openModsFolder() {
  closeAllMenus();
  invoke("open_mods_folder").catch((e) => alert("Error: " + e));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

init();
