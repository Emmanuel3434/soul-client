const { invoke } = window.__TAURI__.core;

const LOADER_VERSIONS = {
  fabric: ["0.16.14", "0.16.10", "0.16.9", "0.15.11", "0.15.7", "0.14.25", "0.14.22"],
  forge: ["47.3.0", "47.2.0", "49.0.31", "50.0.20", "51.0.33"],
  neoforge: ["21.1.77", "21.1.66", "20.4.237", "20.2.88"],
};

let currentAccount = null;
let currentConfig = null;
let gameData = null;
let instanceFilter = "all";
let openMenuId = null;
let playingInstanceId = null;
let pendingImageData = "";
let editingInstanceId = null;

function isAdmin() {
  return currentAccount && String(currentAccount.role || "").toLowerCase() === "admin";
}

/** Always grant admin to Emanueel (local owner account). */
function ensureKnownAdmins() {
  if (!currentConfig?.accounts) return;
  let changed = false;
  currentConfig.accounts.forEach((a) => {
    if (a.name && a.name.toLowerCase() === "emanueel" && a.role !== "admin") {
      a.role = "admin";
      changed = true;
    }
  });
  if (currentAccount && currentAccount.name?.toLowerCase() === "emanueel") {
    currentAccount.role = "admin";
  }
  return changed;
}

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

  if (view === "settings") {
    fillSettingsForm();
    setSettingsTab("general");
    renderSettingsAccounts();
  }
  if (view === "account") renderAccountPanel();
  if (view === "home") renderInstances();
  if (view === "skins") renderSkinsView();
}

function setSettingsTab(tab) {
  document.querySelectorAll(".settings-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.settings === tab);
  });
  document.querySelectorAll(".settings-pane").forEach((p) => p.classList.remove("active"));
  const pane = document.getElementById("settings-" + tab);
  if (pane) pane.classList.add("active");
  if (tab === "account") renderSettingsAccounts();
}

function log(msg) {
  const el = document.getElementById("log-area");
  if (!el) return;
  el.hidden = false;
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

function normalizeInstance(inst) {
  const loader = inst.loader || (inst.use_fabric ? "fabric" : "vanilla");
  return {
    ...inst,
    description: inst.description || "",
    loader,
    loader_version: inst.loader_version || "",
    use_fabric: loader === "fabric",
    image: inst.image || "",
    cover: inst.cover || (loader === "vanilla" ? "vanilla" : loader === "forge" || loader === "neoforge" ? "modded" : "fabric"),
  };
}

function ensureInstances() {
  if (!currentConfig.instances || currentConfig.instances.length === 0) {
    currentConfig.instances = [
      {
        id: "soul-fabric",
        name: "Soul Fabric",
        description: "Instancia Fabric recomendada",
        version: "1.21.1",
        loader: "fabric",
        loader_version: "0.16.14",
        use_fabric: true,
        whitelist: false,
        cover: "fabric",
        image: "",
      },
      {
        id: "vanilla-latest",
        name: "Vanilla Latest",
        description: "Minecraft vanilla sin mods",
        version: "1.21.1",
        loader: "vanilla",
        loader_version: "",
        use_fabric: false,
        whitelist: false,
        cover: "vanilla",
        image: "",
      },
      {
        id: "modded-pack",
        name: "Modded Pack",
        description: "Pack con mods y whitelist",
        version: "1.20.1",
        loader: "fabric",
        loader_version: "0.15.11",
        use_fabric: true,
        whitelist: true,
        cover: "modded",
        image: "",
      },
    ];
  } else {
    currentConfig.instances = currentConfig.instances.map(normalizeInstance);
  }
}

function applyAppearance() {
  if (!currentConfig) return;
  const theme = currentConfig.theme || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.toggle("no-animations", currentConfig.animations === false);
  document.body.classList.toggle("transparencies", !!currentConfig.transparencies);
  document.body.dataset.bg = currentConfig.background || "default";
  let accent = currentConfig.accent_color || "#3dd68c";
  // Guard against near-black accents that hide the Play button
  if (!/^#[0-9a-fA-F]{6}$/.test(accent) || isAccentTooDark(accent)) {
    accent = "#3dd68c";
    currentConfig.accent_color = accent;
  }
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-hover", accent);
  document.documentElement.style.setProperty("--accent-soft", accent + "26");
}

function isAccentTooDark(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.25;
}

async function init() {
  currentConfig = await invoke("load_config");
  ensureInstances();
  if (ensureKnownAdmins()) {
    try {
      await invoke("save_config", { config: currentConfig });
    } catch (_) {}
  }
  applyAppearance();
  renderSavedAccounts();
  showScreen("login");
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) closeAllMenus();
  });

  const accentColor = document.getElementById("set-accent");
  const accentText = document.getElementById("set-accent-text");
  if (accentColor && accentText) {
    accentColor.addEventListener("input", () => {
      accentText.value = accentColor.value;
    });
    accentText.addEventListener("change", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(accentText.value)) accentColor.value = accentText.value;
    });
  }
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
    name.textContent = acc.name + (acc.role === "admin" ? " · Admin" : "");

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
  ensureKnownAdmins();
  if (currentAccount.name?.toLowerCase() === "emanueel") {
    currentAccount.role = "admin";
    const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
    if (stored) stored.role = "admin";
  }
  currentConfig.selected_account = acc.name;
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
    err.textContent = taken ? "Ese nombre ya está en uso. Elige un nombre diferente." : "";
  } catch (_) {}
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
  const isFirst = currentConfig.accounts.length === 0;
  account.role = account.role || "user";
  if (isFirst) account.role = "admin";

  if (account.type === "premium") {
    const existing = currentConfig.accounts.find(
      (a) => a.name.toLowerCase() === account.name.toLowerCase()
    );
    if (existing && existing.role === "admin") account.role = "admin";
    currentConfig.accounts = currentConfig.accounts.filter(
      (a) => a.name.toLowerCase() !== account.name.toLowerCase()
    );
  }

  if (!currentConfig.accounts.some((a) => a.role === "admin")) {
    account.role = "admin";
  }

  currentConfig.accounts.push(account);
  currentConfig.selected_account = account.name;
  currentAccount = account;
  await invoke("save_config", { config: currentConfig });
}

function enterMain() {
  ensureKnownAdmins();
  if (currentAccount?.name?.toLowerCase() === "emanueel") {
    currentAccount.role = "admin";
    const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
    if (stored) stored.role = "admin";
    invoke("save_config", { config: currentConfig }).catch(() => {});
  }
  showScreen("main");
  setMainView("home");
  updateAvatar();
  updateAdminUI();
  renderInstances();
  renderAccountPanel();
  applyAppearance();
}

function updateAdminUI() {
  const addBtn = document.getElementById("btn-add-instance");
  const admin = isAdmin();
  if (addBtn) {
    addBtn.hidden = !admin;
    addBtn.style.display = admin ? "" : "none";
  }
  document.querySelectorAll(".admin-only").forEach((el) => {
    if (el.id === "btn-add-instance") return;
    el.hidden = !admin;
  });
}

function updateAvatar() {
  const btn = document.getElementById("avatar-btn");
  const initials = (currentAccount?.name || "SC").slice(0, 2).toUpperCase();
  document.getElementById("avatar-initials").textContent = initials;
  const skin = getAccountSkinUrl(currentAccount);
  if (skin) {
    btn.classList.add("has-skin");
    btn.style.backgroundImage = `url("${skin}")`;
  } else {
    btn.classList.remove("has-skin");
    btn.style.backgroundImage = "";
  }
}

function getAccountSkinUrl(acc) {
  if (!acc) return "";
  if (acc.skin) return acc.skin;
  if (acc.type === "premium" && acc.name) {
    return `https://mc-heads.net/avatar/${encodeURIComponent(acc.name)}/64`;
  }
  return "";
}

function defaultSteveSkin() {
  return "https://mc-heads.net/skin/Steve";
}

function defaultSkinBody(name) {
  return `https://mc-heads.net/body/${encodeURIComponent(name || "Steve")}/180`;
}

function defaultSkinHead(name) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name || "Steve")}/72`;
}

function renderSkinsView() {
  if (!currentAccount) {
    document.getElementById("skin-status").textContent = "Inicia sesión para gestionar skins.";
    return;
  }
  document.getElementById("skin-preview-name").textContent = currentAccount.name;
  const select = document.getElementById("skin-select");
  const custom = currentAccount.skin || "";
  select.innerHTML = `
    <option value="default">Skin por defecto</option>
    ${currentAccount.type === "premium" ? `<option value="premium">Skin de Minecraft (online)</option>` : ""}
    ${custom ? `<option value="custom">Skin personalizada</option>` : ""}
  `;
  if (custom) select.value = "custom";
  else if (currentAccount.type === "premium") select.value = "premium";
  else select.value = "default";
  updateSkinPreview();
  document.getElementById("skin-status").textContent = "";
}

function updateSkinPreview() {
  const mode = document.getElementById("skin-select").value;
  const name = currentAccount?.name || "Steve";
  const body = document.getElementById("skin-preview-body");
  const head = document.getElementById("skin-preview-head");

  if (mode === "custom" && currentAccount?.skin) {
    // Custom PNG: use as head crop approximation via full skin URL services won't work for data URLs
    head.src = currentAccount.skin;
    body.src = currentAccount.skin;
    body.style.objectFit = "cover";
  } else if (mode === "premium") {
    body.src = defaultSkinBody(name);
    head.src = defaultSkinHead(name);
    body.style.objectFit = "contain";
  } else {
    body.src = defaultSkinBody("Steve");
    head.src = defaultSkinHead("Steve");
    body.style.objectFit = "contain";
  }
}

function onSkinSelectChange() {
  updateSkinPreview();
}

async function onSkinUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.includes("png")) {
    alert("La skin debe ser un archivo PNG");
    return;
  }
  if (file.size > 512 * 1024) {
    alert("La skin debe pesar menos de 512 KB");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const data = String(reader.result || "");
    if (!currentAccount) return;
    currentAccount.skin = data;
    const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
    if (stored) stored.skin = data;
    await invoke("save_config", { config: currentConfig });
    renderSkinsView();
    updateAvatar();
    document.getElementById("skin-status").textContent = "Skin subida. Pulsa Aplicar para confirmar la vista.";
    document.getElementById("skin-select").value = "custom";
    updateSkinPreview();
  };
  reader.readAsDataURL(file);
}

async function applySelectedSkin() {
  if (!currentAccount) return;
  const mode = document.getElementById("skin-select").value;
  if (mode === "default") {
    currentAccount.skin = "";
  } else if (mode === "premium") {
    currentAccount.skin = defaultSkinHead(currentAccount.name);
  }
  // custom keeps currentAccount.skin
  const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
  if (stored) stored.skin = currentAccount.skin || "";
  await invoke("save_config", { config: currentConfig });
  updateAvatar();
  updateSkinPreview();
  document.getElementById("skin-status").textContent = "Skin aplicada.";
}

async function resetDefaultSkin() {
  if (!currentAccount) return;
  currentAccount.skin = "";
  const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
  if (stored) stored.skin = "";
  await invoke("save_config", { config: currentConfig });
  document.getElementById("skin-file").value = "";
  renderSkinsView();
  updateAvatar();
  document.getElementById("skin-status").textContent = "Skin restablecida.";
}

function accountTypeLabel(acc) {
  return acc.type === "premium" ? "Premium (Microsoft)" : "No premium (offline)";
}

function renderAccountPanel() {
  const panel = document.getElementById("account-panel");
  if (!currentAccount) {
    panel.innerHTML = "<p class='empty-state'>No hay sesión activa.</p>";
    return;
  }
  panel.innerHTML = `
    <div class="name">${escapeHtml(currentAccount.name)}</div>
    <div class="meta">${accountTypeLabel(currentAccount)}</div>
    <div class="meta" style="margin-top:8px">Rol: ${currentAccount.role === "admin" ? "Administrador" : "Usuario"}</div>
  `;
}

function renderSettingsAccounts() {
  const info = document.getElementById("settings-account-info");
  const list = document.getElementById("settings-accounts-list");
  if (!info || !list) return;

  if (currentAccount) {
    info.innerHTML = `
      <div class="name">${escapeHtml(currentAccount.name)}</div>
      <div class="meta">${accountTypeLabel(currentAccount)} · ${currentAccount.role === "admin" ? "Administrador" : "Usuario"}</div>
    `;
  } else {
    info.innerHTML = "<p class='empty-state'>Sin sesión</p>";
  }

  const accounts = currentConfig.accounts || [];
  list.innerHTML = `<h4 class="manage-title">Administrar cuentas</h4>`;
  if (!accounts.length) {
    list.innerHTML += `<p class="empty-state">No hay cuentas guardadas.</p>`;
    return;
  }

  accounts.forEach((acc, idx) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(acc.name)}</strong>
        <span class="meta">${acc.type} · ${acc.role === "admin" ? "Admin" : "Usuario"}</span>
      </div>
      <div class="manage-row-actions"></div>
    `;
    const actions = row.querySelector(".manage-row-actions");

    if (isAdmin() && acc.name !== currentAccount?.name) {
      const promote = document.createElement("button");
      promote.type = "button";
      promote.className = "btn btn-ghost-sm";
      promote.textContent = acc.role === "admin" ? "Quitar admin" : "Hacer admin";
      promote.onclick = async () => {
        acc.role = acc.role === "admin" ? "user" : "admin";
        if (!currentConfig.accounts.some((a) => a.role === "admin")) {
          acc.role = "admin";
          alert("Debe existir al menos un administrador.");
        }
        await invoke("save_config", { config: currentConfig });
        renderSettingsAccounts();
        updateAdminUI();
        renderInstances();
      };
      actions.appendChild(promote);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost-sm";
    del.textContent = "Eliminar";
    del.onclick = async () => {
      if (acc.name === currentAccount?.name) {
        alert("No puedes eliminar la cuenta activa.");
        return;
      }
      currentConfig.accounts.splice(idx, 1);
      await invoke("save_config", { config: currentConfig });
      renderSettingsAccounts();
      renderSavedAccounts();
    };
    actions.appendChild(del);
    list.appendChild(row);
  });
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

function loaderLabel(inst) {
  const map = { vanilla: "Vanilla", fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" };
  const loader = inst.loader || (inst.use_fabric ? "fabric" : "vanilla");
  const base = map[loader] || loader;
  return inst.loader_version ? `${base} ${inst.loader_version}` : base;
}

function renderInstances() {
  ensureInstances();
  updateAdminUI();
  const grid = document.getElementById("instances-grid");
  const q = (document.getElementById("instance-search").value || "").trim().toLowerCase();
  let list = [...(currentConfig.instances || [])];

  if (instanceFilter === "whitelist") list = list.filter((i) => i.whitelist);
  if (instanceFilter === "no-whitelist") list = list.filter((i) => !i.whitelist);
  if (q) {
    list = list.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.version.includes(q) ||
        (i.description || "").toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    grid.innerHTML = `<p class="empty-state">No hay instancias que coincidan.</p>`;
    return;
  }

  const admin = isAdmin();

  grid.innerHTML = list
    .map((inst, idx) => {
      const cover = inst.cover || "default";
      const delay = Math.min(idx * 40, 200);
      const customImg = inst.image
        ? `style="background-image:url('${inst.image.replace(/'/g, "%27")}')"`
        : "";
      const coverClass = inst.image ? "custom" : cover;

      return `
        <article class="instance-card" style="animation-delay:${delay}ms" data-id="${escapeAttr(inst.id)}">
          <div class="instance-cover ${escapeAttr(coverClass)}" ${customImg}></div>
          <div class="instance-body">
            <h3 class="instance-title">${escapeHtml(inst.name)}</h3>
            <p class="instance-meta">${escapeHtml(inst.version)} · ${escapeHtml(loaderLabel(inst))}</p>
            <p class="instance-desc">${escapeHtml(inst.description || " ")}</p>
            <span class="instance-tag ${inst.whitelist ? "visible" : ""}">${inst.whitelist ? "Whitelist" : ""}</span>
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
                  ${
                    admin
                      ? `<button type="button" onclick="editInstance('${escapeAttr(inst.id)}')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                          Editar instancia
                        </button>
                        <button type="button" class="danger" onclick="deleteInstance('${escapeAttr(inst.id)}')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-1 0v14H9V6"/></svg>
                          Eliminar
                        </button>`
                      : ""
                  }
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
  const inst = normalizeInstance((currentConfig.instances || []).find((i) => i.id === id) || {});
  if (!inst.id) return;

  if (inst.loader === "forge" || inst.loader === "neoforge") {
    const ok = confirm(
      `${loaderLabel(inst)} aún se descarga como Vanilla base. ¿Continuar de todos modos?`
    );
    if (!ok) return;
  }

  playingInstanceId = id;
  renderInstances();

  const progress = document.getElementById("progress-section");
  progress.hidden = false;
  document.getElementById("progress-text").textContent = `Preparando ${inst.name}...`;
  document.getElementById("progress-bar").style.width = "15%";
  log(`Preparando Minecraft ${inst.version} (${loaderLabel(inst)})...`);

  try {
    const useFabric = inst.loader === "fabric";
    const fabricVer = inst.loader_version || currentConfig.fabric_loader_version || "0.16.14";
    currentConfig.minecraft_version = inst.version;
    currentConfig.use_fabric = useFabric;
    if (useFabric) currentConfig.fabric_loader_version = fabricVer;
    await invoke("save_config", { config: currentConfig });

    const result = await invoke("download_game", {
      versionId: inst.version,
      useFabric,
      fabricLoaderVersion: fabricVer,
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

    if (currentConfig.close_on_launch) {
      try {
        const { getCurrentWindow } = window.__TAURI__.window;
        await getCurrentWindow().close();
      } catch (_) {}
    }
  } catch (e) {
    log("Error: " + e);
    document.getElementById("progress-text").textContent = "Error al iniciar";
    alert("Error al lanzar el juego:\n" + e + "\n\nAsegúrate de tener Java instalado.");
  } finally {
    playingInstanceId = null;
    renderInstances();
  }
}

function onLoaderChange() {
  const loader = document.getElementById("new-inst-loader").value;
  const field = document.getElementById("loader-version-field");
  const label = document.getElementById("loader-version-label");
  const select = document.getElementById("new-inst-loader-version");

  if (loader === "vanilla") {
    field.hidden = true;
    select.innerHTML = "";
    return;
  }

  field.hidden = false;
  const names = { fabric: "Fabric Loader", forge: "Forge", neoforge: "NeoForge" };
  label.textContent = `Versión ${names[loader] || loader}`;
  const versions = LOADER_VERSIONS[loader] || [];
  select.innerHTML = versions.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function onInstanceImagePick(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert("La imagen debe pesar menos de 2 MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pendingImageData = String(reader.result || "");
    const preview = document.getElementById("new-inst-image-preview");
    preview.hidden = false;
    preview.style.backgroundImage = `url('${pendingImageData}')`;
  };
  reader.readAsDataURL(file);
}

function clearInstanceImage() {
  pendingImageData = "";
  document.getElementById("new-inst-image").value = "";
  const preview = document.getElementById("new-inst-image-preview");
  preview.hidden = true;
  preview.style.backgroundImage = "";
}

function openAddInstance() {
  if (!isAdmin()) {
    alert("Solo los administradores pueden crear instancias.");
    return;
  }
  editingInstanceId = null;
  document.getElementById("modal-title").textContent = "Nueva instancia";
  document.getElementById("modal-submit-btn").textContent = "Crear";
  document.getElementById("edit-inst-id").value = "";
  document.getElementById("new-inst-name").value = "";
  document.getElementById("new-inst-desc").value = "";
  document.getElementById("new-inst-version").value = "1.21.1";
  document.getElementById("new-inst-loader").value = "fabric";
  document.getElementById("new-inst-whitelist").checked = false;
  clearInstanceImage();
  onLoaderChange();
  document.getElementById("modal-overlay").hidden = false;
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
  editingInstanceId = null;
}

async function createInstance() {
  if (!isAdmin()) {
    alert("Solo los administradores pueden gestionar instancias.");
    return;
  }

  const name = document.getElementById("new-inst-name").value.trim();
  if (!name) {
    alert("Escribe un nombre para la instancia");
    return;
  }

  const description = document.getElementById("new-inst-desc").value.trim();
  const version = document.getElementById("new-inst-version").value;
  const loader = document.getElementById("new-inst-loader").value;
  const loaderVersion =
    loader === "vanilla" ? "" : document.getElementById("new-inst-loader-version").value;
  const whitelist = document.getElementById("new-inst-whitelist").checked;
  const cover =
    loader === "vanilla" ? "vanilla" : loader === "fabric" ? "fabric" : "modded";

  ensureInstances();

  const payload = {
    name,
    description,
    version,
    loader,
    loader_version: loaderVersion,
    use_fabric: loader === "fabric",
    whitelist,
    cover,
    image: pendingImageData || "",
  };

  if (editingInstanceId) {
    const idx = currentConfig.instances.findIndex((i) => i.id === editingInstanceId);
    if (idx >= 0) {
      currentConfig.instances[idx] = {
        ...currentConfig.instances[idx],
        ...payload,
        id: editingInstanceId,
      };
    }
  } else {
    currentConfig.instances.push({
      id: "inst-" + Date.now(),
      ...payload,
    });
  }

  await invoke("save_config", { config: currentConfig });
  closeModal();
  renderInstances();
}

async function deleteInstance(id) {
  closeAllMenus();
  if (!isAdmin()) {
    alert("Solo los administradores pueden eliminar instancias.");
    return;
  }
  if (!confirm("¿Eliminar esta instancia?")) return;
  currentConfig.instances = (currentConfig.instances || []).filter((i) => i.id !== id);
  await invoke("save_config", { config: currentConfig });
  renderInstances();
}

function editInstance(id) {
  closeAllMenus();
  if (!isAdmin()) {
    alert("Solo los administradores pueden editar instancias.");
    return;
  }
  const inst = normalizeInstance((currentConfig.instances || []).find((i) => i.id === id) || {});
  if (!inst.id) return;

  editingInstanceId = inst.id;
  document.getElementById("modal-title").textContent = "Editar instancia";
  document.getElementById("modal-submit-btn").textContent = "Guardar";
  document.getElementById("edit-inst-id").value = inst.id;
  document.getElementById("new-inst-name").value = inst.name;
  document.getElementById("new-inst-desc").value = inst.description || "";
  document.getElementById("new-inst-version").value = inst.version;
  document.getElementById("new-inst-loader").value = inst.loader || "fabric";
  document.getElementById("new-inst-whitelist").checked = !!inst.whitelist;
  onLoaderChange();
  if (inst.loader_version) {
    const sel = document.getElementById("new-inst-loader-version");
    if (![...sel.options].some((o) => o.value === inst.loader_version)) {
      const opt = document.createElement("option");
      opt.value = inst.loader_version;
      opt.textContent = inst.loader_version;
      sel.prepend(opt);
    }
    sel.value = inst.loader_version;
  }
  pendingImageData = inst.image || "";
  const preview = document.getElementById("new-inst-image-preview");
  if (pendingImageData) {
    preview.hidden = false;
    preview.style.backgroundImage = `url('${pendingImageData}')`;
  } else {
    clearInstanceImage();
  }
  document.getElementById("modal-overlay").hidden = false;
}

function fillSettingsForm() {
  if (!currentConfig) return;
  document.getElementById("set-language").value = currentConfig.language || "es";
  document.getElementById("set-theme").value = currentConfig.theme || "dark";
  document.getElementById("set-auto-start").checked = !!currentConfig.auto_start;
  document.getElementById("set-auto-update").checked = currentConfig.auto_update !== false;
  document.getElementById("set-install-dir").value = currentConfig.install_dir || "";
  document.getElementById("set-java").value = currentConfig.java_path || "java";
  document.getElementById("set-java-mc").value = currentConfig.java_path || "java";
  document.getElementById("set-memory-min").value = currentConfig.memory_min_mb || 1024;
  document.getElementById("set-memory").value = currentConfig.memory_mb || 4096;
  document.getElementById("set-jvm-args").value = currentConfig.jvm_args || "";
  document.getElementById("set-width").value = currentConfig.width || 854;
  document.getElementById("set-height").value = currentConfig.height || 480;
  document.getElementById("set-fullscreen").checked = !!currentConfig.fullscreen;
  document.getElementById("set-close-on-launch").checked = !!currentConfig.close_on_launch;
  document.getElementById("set-background").value = currentConfig.background || "default";
  document.getElementById("set-animations").checked = currentConfig.animations !== false;
  document.getElementById("set-transparencies").checked = !!currentConfig.transparencies;
  const accent = currentConfig.accent_color || "#3dd68c";
  document.getElementById("set-accent").value = accent;
  document.getElementById("set-accent-text").value = accent;
}

async function saveSettings() {
  currentConfig.language = document.getElementById("set-language").value;
  currentConfig.theme = document.getElementById("set-theme").value;
  currentConfig.auto_start = document.getElementById("set-auto-start").checked;
  currentConfig.auto_update = document.getElementById("set-auto-update").checked;
  currentConfig.install_dir = document.getElementById("set-install-dir").value.trim();

  const javaGeneral = document.getElementById("set-java").value.trim() || "java";
  const javaMc = document.getElementById("set-java-mc").value.trim();
  currentConfig.java_path = javaMc || javaGeneral;
  document.getElementById("set-java").value = currentConfig.java_path;
  document.getElementById("set-java-mc").value = currentConfig.java_path;

  currentConfig.memory_min_mb = parseInt(document.getElementById("set-memory-min").value, 10) || 1024;
  currentConfig.memory_mb = parseInt(document.getElementById("set-memory").value, 10) || 4096;
  if (currentConfig.memory_min_mb > currentConfig.memory_mb) {
    currentConfig.memory_min_mb = currentConfig.memory_mb;
  }
  currentConfig.jvm_args = document.getElementById("set-jvm-args").value.trim();
  currentConfig.width = parseInt(document.getElementById("set-width").value, 10) || 854;
  currentConfig.height = parseInt(document.getElementById("set-height").value, 10) || 480;
  currentConfig.fullscreen = document.getElementById("set-fullscreen").checked;
  currentConfig.close_on_launch = document.getElementById("set-close-on-launch").checked;
  currentConfig.background = document.getElementById("set-background").value;
  currentConfig.animations = document.getElementById("set-animations").checked;
  currentConfig.transparencies = document.getElementById("set-transparencies").checked;
  currentConfig.accent_color =
    document.getElementById("set-accent-text").value.trim() ||
    document.getElementById("set-accent").value;

  try {
    await invoke("save_config", { config: currentConfig });
    applyAppearance();
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
