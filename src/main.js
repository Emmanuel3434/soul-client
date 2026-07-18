const { invoke } = window.__TAURI__.core;

const LOADER_VERSIONS = {
  fabric: [
    "0.16.14",
    "0.16.10",
    "0.16.9",
    "0.15.11",
    "0.15.7",
    "0.14.25",
    "0.14.22",
    "0.14.21",
    "0.14.19",
    "0.14.14",
    "0.14.9",
    "0.13.3",
    "0.12.12",
  ],
  forge: ["47.3.0", "47.2.0", "49.0.31", "50.0.20", "51.0.33", "43.3.0", "40.2.0"],
  neoforge: ["21.1.77", "21.1.66", "20.4.237", "20.2.88"],
};

/** Recommended Fabric Loader per Minecraft version (1.18 / 1.19 focus). */
const FABRIC_DEFAULT_FOR_MC = {
  "1.21.1": "0.16.14",
  "1.21": "0.16.14",
  "1.20.6": "0.15.11",
  "1.20.4": "0.15.11",
  "1.20.1": "0.15.11",
  "1.19.4": "0.14.22",
  "1.19.3": "0.14.21",
  "1.19.2": "0.14.21",
  "1.19": "0.14.19",
  "1.18.2": "0.14.21",
  "1.18.1": "0.14.14",
  "1.18": "0.14.9",
  "1.16.5": "0.14.9",
};

function recommendedFabricLoader(mcVersion) {
  return FABRIC_DEFAULT_FOR_MC[mcVersion] || LOADER_VERSIONS.fabric[0];
}

/** Compatible Fabric loaders for a given Minecraft version (recommended first). */
function fabricLoadersForMc(mcVersion) {
  const preferred = recommendedFabricLoader(mcVersion);
  const all = LOADER_VERSIONS.fabric;
  let prefixes = ["0.16.", "0.15.", "0.14.", "0.13.", "0.12."];
  if (mcVersion.startsWith("1.18") || mcVersion.startsWith("1.19")) {
    prefixes = ["0.14.", "0.13."];
  } else if (mcVersion.startsWith("1.20")) {
    prefixes = ["0.15.", "0.14.", "0.16."];
  } else if (mcVersion.startsWith("1.21")) {
    prefixes = ["0.16.", "0.15."];
  } else if (mcVersion.startsWith("1.16") || mcVersion.startsWith("1.17")) {
    prefixes = ["0.14.", "0.13.", "0.12."];
  }
  const compatible = all.filter((v) => prefixes.some((p) => v.startsWith(p)));
  const list = compatible.length ? compatible : all;
  return [preferred, ...list.filter((v) => v !== preferred)];
}

let currentAccount = null;
let currentConfig = null;
let gameData = null;
let instanceFilter = "all";
let openMenuId = null;
let playingInstanceId = null;
let pendingImageData = "";
let editingInstanceId = null;
let installedVersions = [];

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
  if (view !== "skins") {
    try {
      destroySkinViewer();
    } catch (_) {}
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".sidebar-item").forEach((n) => n.classList.remove("active"));
  const viewEl = document.getElementById("view-" + view);
  if (viewEl) viewEl.classList.add("active");
  const navView = view === "library" ? "home" : view;
  const nav = document.querySelector(`.sidebar-item[data-view="${navView}"]`);
  if (nav) nav.classList.add("active");
  if (view === "account") {
    /* account has no sidebar item highlight beyond avatar */
  }

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

function defaultInstancesList() {
  return [
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
      id: "soul-fabric-119",
      name: "Soul Fabric 1.19",
      description: "Fabric para Minecraft 1.19.2",
      version: "1.19.2",
      loader: "fabric",
      loader_version: "0.14.21",
      use_fabric: true,
      whitelist: false,
      cover: "fabric",
      image: "",
    },
    {
      id: "soul-fabric-118",
      name: "Soul Fabric 1.18",
      description: "Fabric para Minecraft 1.18.2",
      version: "1.18.2",
      loader: "fabric",
      loader_version: "0.14.21",
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
}

function ensureInstances() {
  if (!currentConfig.instances || currentConfig.instances.length === 0) {
    currentConfig.instances = defaultInstancesList();
    return true;
  }
  currentConfig.instances = currentConfig.instances.map(normalizeInstance);
  const ids = new Set(currentConfig.instances.map((i) => i.id));
  let added = false;
  for (const preset of defaultInstancesList()) {
    if ((preset.id === "soul-fabric-118" || preset.id === "soul-fabric-119") && !ids.has(preset.id)) {
      currentConfig.instances.push(preset);
      added = true;
    }
  }
  return added;
}

function applyAppearance() {
  if (!currentConfig) return;
  const theme = currentConfig.theme || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.toggle("no-animations", currentConfig.animations === false);
  document.body.classList.toggle("transparencies", !!currentConfig.transparencies);
  document.body.dataset.bg = currentConfig.background || "default";
  let accent = currentConfig.accent_color || "#4c8dff";
  // Guard against near-black accents that hide the Play button
  if (!/^#[0-9a-fA-F]{6}$/.test(accent) || isAccentTooDark(accent)) {
    accent = "#4c8dff";
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
  const instancesChanged = ensureInstances();
  const adminsChanged = ensureKnownAdmins();
  if (instancesChanged || adminsChanged) {
    try {
      await invoke("save_config", { config: currentConfig });
    } catch (_) {}
  }
  applyAppearance();
  await refreshInstalledVersions();
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
  if (!container) return;
  // Cuentas sugeridas ocultas por ahora
  container.innerHTML = "";
  container.hidden = true;
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
  document.getElementById("auth-error").textContent = "";
  document.getElementById("auth-loading").hidden = false;
  document.getElementById("auth-form").hidden = true;
  doMicrosoftLogin();
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
  const err = document.getElementById("auth-error");
  const loading = document.getElementById("auth-loading");
  try {
    const account = await invoke("login_microsoft");
    loading.hidden = true;
    await addAccount(account);
    currentAccount = account;
    enterMain();
  } catch (e) {
    loading.hidden = true;
    document.getElementById("auth-form").hidden = false;
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

async function enterMain() {
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
  await refreshInstalledVersions();
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
  const initialsEl = document.getElementById("avatar-initials");
  if (initialsEl) initialsEl.textContent = initials;
  if (!btn) return;
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

const STEVE_SKIN_URL = "vendor/steve.png";

let skinViewer = null;
let activeWardrobeSkinId = null;
let activeWardrobeSkinData = "";

function ensureSavedSkins() {
  if (!currentConfig.saved_skins) currentConfig.saved_skins = [];
}

function getSkinViewerLib() {
  return window.skinview3d || null;
}

function destroySkinViewer() {
  if (skinViewer) {
    try {
      skinViewer.dispose?.();
    } catch (_) {}
    skinViewer = null;
  }
}

async function initSkinViewer(skinUrl) {
  const canvas = document.getElementById("skin-canvas");
  const fallback = document.getElementById("skin-fallback");
  if (!canvas) return;

  const lib = getSkinViewerLib();
  if (!lib || !lib.SkinViewer) {
    // Wait briefly for deferred script
    await new Promise((r) => setTimeout(r, 200));
  }
  const lib2 = getSkinViewerLib();
  if (!lib2 || !lib2.SkinViewer) {
    if (fallback) {
      fallback.hidden = false;
      fallback.innerHTML = "<p>No se pudo cargar el visor 3D.</p>";
    }
    return;
  }
  if (fallback) fallback.hidden = true;

  const url = skinUrl || STEVE_SKIN_URL;
  try {
    if (!skinViewer) {
      skinViewer = new lib2.SkinViewer({
        canvas,
        width: 320,
        height: 420,
        skin: url,
      });
      try {
        skinViewer.background = 0x00000000;
      } catch (_) {}
      if (skinViewer.controls) {
        skinViewer.controls.enableZoom = true;
        skinViewer.controls.enableRotate = true;
        skinViewer.controls.enablePan = false;
      }
      try {
        if (lib2.WalkingAnimation) {
          skinViewer.animation = new lib2.WalkingAnimation();
          skinViewer.animation.speed = 0.55;
        }
      } catch (_) {}
    } else {
      await skinViewer.loadSkin(url);
    }
    activeWardrobeSkinData = url;
  } catch (e) {
    console.error("skinview error", e);
    if (fallback) {
      fallback.hidden = false;
      fallback.innerHTML = "<p>Error al cargar la skin. Usa un PNG 64×64 válido.</p>";
    }
  }
}

function renderSavedSkinsGrid() {
  ensureSavedSkins();
  const grid = document.getElementById("saved-skins-grid");
  if (!grid) return;

  const addBtn = `<button type="button" class="skin-add-tile" id="btn-add-skin" title="Agregar skin" onclick="document.getElementById('skin-file').click()">
    <span class="skin-add-plus">+</span>
  </button>`;

  const tiles = (currentConfig.saved_skins || [])
    .map((s) => {
      const active = s.id === activeWardrobeSkinId ? "active" : "";
      return `<button type="button" class="skin-tile ${active}" data-id="${escapeAttr(s.id)}" onclick="selectSavedSkin('${escapeAttr(s.id)}')">
        <img src="${s.data}" alt="${escapeHtml(s.name)}" />
        <span class="skin-tile-del" onclick="event.stopPropagation(); deleteSavedSkin('${escapeAttr(s.id)}')">×</span>
      </button>`;
    })
    .join("");

  grid.innerHTML = tiles + addBtn;
}

function renderSkinsView() {
  const nameEl = document.getElementById("skin-preview-name");
  const status = document.getElementById("skin-status");
  if (!currentAccount) {
    if (nameEl) nameEl.textContent = "Sin sesión";
    if (status) status.textContent = "Inicia sesión para gestionar skins.";
    destroySkinViewer();
    return;
  }

  ensureSavedSkins();
  if (nameEl) nameEl.textContent = currentAccount.name;
  if (status) status.textContent = "";

  if (currentAccount.skin) {
    activeWardrobeSkinData = currentAccount.skin;
    const match = (currentConfig.saved_skins || []).find((s) => s.data === currentAccount.skin);
    activeWardrobeSkinId = match ? match.id : null;
  } else if ((currentConfig.saved_skins || []).length) {
    activeWardrobeSkinId = currentConfig.saved_skins[0].id;
    activeWardrobeSkinData = currentConfig.saved_skins[0].data;
  } else {
    activeWardrobeSkinId = null;
    activeWardrobeSkinData = STEVE_SKIN_URL;
  }

  renderSavedSkinsGrid();
  requestAnimationFrame(() => initSkinViewer(activeWardrobeSkinData));
}

async function selectSavedSkin(id) {
  ensureSavedSkins();
  const skin = (currentConfig.saved_skins || []).find((s) => s.id === id);
  if (!skin) return;
  activeWardrobeSkinId = id;
  activeWardrobeSkinData = skin.data;
  renderSavedSkinsGrid();
  await initSkinViewer(skin.data);
  const st = document.getElementById("skin-status");
  if (st) st.textContent = `Vista: ${skin.name}`;
}

async function deleteSavedSkin(id) {
  ensureSavedSkins();
  currentConfig.saved_skins = currentConfig.saved_skins.filter((s) => s.id !== id);
  if (activeWardrobeSkinId === id) {
    activeWardrobeSkinId = null;
    activeWardrobeSkinData = currentAccount?.skin || STEVE_SKIN_URL;
    await initSkinViewer(activeWardrobeSkinData);
  }
  await invoke("save_config", { config: currentConfig });
  renderSavedSkinsGrid();
}

async function onSkinUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (event.target) event.target.value = "";
  if (!file) return;
  if (!file.type.includes("png") && !file.name.toLowerCase().endsWith(".png")) {
    alert("La skin debe ser un archivo PNG (64×64 o 64×32)");
    return;
  }
  if (file.size > 1024 * 1024) {
    alert("La skin debe pesar menos de 1 MB");
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const data = String(reader.result || "");
    const ok = await validateSkinPng(data);
    if (!ok) {
      alert("PNG inválido. Usa una skin de Minecraft 64×64 (o 64×32 legacy).");
      return;
    }

    ensureSavedSkins();
    const entry = {
      id: "skin-" + Date.now(),
      name: file.name.replace(/\.png$/i, "") || "Skin",
      data,
      created_at: Date.now(),
    };
    currentConfig.saved_skins.unshift(entry);
    activeWardrobeSkinId = entry.id;
    activeWardrobeSkinData = data;
    await invoke("save_config", { config: currentConfig });
    renderSavedSkinsGrid();
    await initSkinViewer(data);
    const st = document.getElementById("skin-status");
    if (st) st.textContent = "Skin agregada al guardarropa.";
  };
  reader.readAsDataURL(file);
}

function validateSkinPng(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      resolve((w === 64 && (h === 64 || h === 32)) || (w === 128 && h === 128));
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

async function applyActiveWardrobeSkin() {
  if (!currentAccount) return;
  const data = activeWardrobeSkinData;
  const isSteve = !data || data === STEVE_SKIN_URL;
  currentAccount.skin = isSteve ? "" : data;
  const stored = (currentConfig.accounts || []).find((a) => a.name === currentAccount.name);
  if (stored) stored.skin = currentAccount.skin;
  await invoke("save_config", { config: currentConfig });
  updateAvatar();
  const st = document.getElementById("skin-status");
  if (st) st.textContent = "Skin aplicada a tu cuenta.";
}

async function useDefaultSteveSkin() {
  activeWardrobeSkinId = null;
  activeWardrobeSkinData = STEVE_SKIN_URL;
  renderSavedSkinsGrid();
  await initSkinViewer(STEVE_SKIN_URL);
  const st = document.getElementById("skin-status");
  if (st) st.textContent = "Vista: Steve (por defecto).";
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

function instanceMetaLine(inst) {
  const map = { vanilla: "VANILLA", fabric: "FABRIC", forge: "FORGE", neoforge: "NEOFORGE" };
  const loader = inst.loader || (inst.use_fabric ? "fabric" : "vanilla");
  const premium = currentAccount && currentAccount.type === "premium" ? "PREMIUM" : "NO PREMIUM";
  return `${map[loader] || String(loader).toUpperCase()} / ${inst.version} / ${premium}`;
}

function fabricVersionId(inst) {
  const ver = inst.loader_version || recommendedFabricLoader(inst.version);
  return `fabric-loader-${ver}-${inst.version}`;
}

function isInstanceInstalled(inst) {
  if (!installedVersions.length) return false;
  const ids = new Set(installedVersions.map((v) => v.id));
  if (ids.has(inst.version)) return true;
  if ((inst.loader === "fabric" || inst.use_fabric) && ids.has(fabricVersionId(inst))) return true;
  return false;
}

async function refreshInstalledVersions() {
  try {
    installedVersions = await invoke("get_installed_versions");
  } catch (_) {
    installedVersions = [];
  }
}

function updateInstancesCount(total, installed) {
  const el = document.getElementById("instances-count");
  if (!el) return;
  const n = total ?? (currentConfig?.instances || []).length;
  const inst = installed ?? (currentConfig?.instances || []).filter(isInstanceInstalled).length;
  el.textContent = `${n} instancia${n === 1 ? "" : "s"} / ${inst} instalada${inst === 1 ? "" : "s"}`;
}

function renderInstances() {
  ensureInstances();
  updateAdminUI();
  const grid = document.getElementById("instances-grid");
  const q = (document.getElementById("instance-search").value || "").trim().toLowerCase();
  let list = [...(currentConfig.instances || [])];
  const totalAll = list.length;

  if (instanceFilter === "whitelist") list = list.filter((i) => i.whitelist);
  if (instanceFilter === "no-whitelist") list = list.filter((i) => !i.whitelist);
  if (q) {
    list = list.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.version.includes(q) ||
        (i.description || "").toLowerCase().includes(q) ||
        (i.loader || "").toLowerCase().includes(q)
    );
  }

  updateInstancesCount(
    totalAll,
    (currentConfig.instances || []).filter(isInstanceInstalled).length
  );

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
      const installed = isInstanceInstalled(inst);
      const studio = (inst.description || "SoulClient").toUpperCase();

      return `
        <article class="instance-card" style="animation-delay:${delay}ms" data-id="${escapeAttr(inst.id)}">
          <div class="instance-cover ${escapeAttr(coverClass)}" ${customImg}>
            ${installed ? `<span class="instance-badge">Instalado</span>` : ""}
            <div class="instance-cover-fade">
              <p class="instance-studio">${escapeHtml(studio.slice(0, 42))}</p>
              <h3 class="instance-title">${escapeHtml(inst.name)}</h3>
              <p class="instance-meta">${escapeHtml(instanceMetaLine(inst))}</p>
            </div>
          </div>
          <div class="instance-body">
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
    const fabricVer =
      inst.loader_version ||
      recommendedFabricLoader(inst.version) ||
      currentConfig.fabric_loader_version ||
      "0.16.14";
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
    await refreshInstalledVersions();

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
  const mcVersion = document.getElementById("new-inst-version").value;

  if (loader === "vanilla") {
    field.hidden = true;
    select.innerHTML = "";
    return;
  }

  field.hidden = false;
  const names = { fabric: "Fabric Loader", forge: "Forge", neoforge: "NeoForge" };
  label.textContent = `Versión ${names[loader] || loader}`;

  let versions = LOADER_VERSIONS[loader] || [];
  let preferred = versions[0] || "";
  if (loader === "fabric") {
    versions = fabricLoadersForMc(mcVersion);
    preferred = recommendedFabricLoader(mcVersion);
  }

  select.innerHTML = versions.map((v) => `<option value="${v}">${v}</option>`).join("");
  if (preferred && [...select.options].some((o) => o.value === preferred)) {
    select.value = preferred;
  }
}

/** Keep Fabric Loader compatible when Minecraft version changes (1.18 / 1.19). */
function onMcVersionChange() {
  const loader = document.getElementById("new-inst-loader").value;
  if (loader === "fabric") {
    onLoaderChange();
  }
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
  onMcVersionChange();
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
  let loaderVersion =
    loader === "vanilla" ? "" : document.getElementById("new-inst-loader-version").value;
  if (loader === "fabric" && !loaderVersion) {
    loaderVersion = recommendedFabricLoader(version);
  }
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
