use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub name: String,
    pub id: String,
    #[serde(rename = "type")]
    pub account_type: String,
    #[serde(default)]
    pub token: String,
    #[serde(default = "default_role")]
    pub role: String,
    /// Base64 data URL or remote skin URL
    #[serde(default)]
    pub skin: String,
}

fn default_role() -> String {
    "user".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSkin {
    pub id: String,
    pub name: String,
    /// data URL (image/png)
    pub data: String,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstance {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub version: String,
    /// vanilla | fabric | forge | neoforge
    #[serde(default = "default_loader")]
    pub loader: String,
    #[serde(default)]
    pub loader_version: String,
    /// Legacy compatibility
    #[serde(default = "default_true")]
    pub use_fabric: bool,
    #[serde(default)]
    pub whitelist: bool,
    #[serde(default = "default_cover")]
    pub cover: String,
    /// data URL or relative path for custom image
    #[serde(default)]
    pub image: String,
}

fn default_cover() -> String {
    "default".to_string()
}

fn default_loader() -> String {
    "fabric".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    #[serde(default = "default_accounts")]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub selected_account: Option<String>,
    #[serde(default = "default_instances")]
    pub instances: Vec<GameInstance>,
    #[serde(default)]
    pub saved_skins: Vec<SavedSkin>,

    // Minecraft / launch
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
    #[serde(default = "default_memory_min")]
    pub memory_min_mb: u32,
    #[serde(default = "default_java_path")]
    pub java_path: String,
    #[serde(default)]
    pub jvm_args: String,
    #[serde(default = "default_version")]
    pub minecraft_version: String,
    #[serde(default = "default_true")]
    pub use_fabric: bool,
    #[serde(default = "default_fabric_loader")]
    pub fabric_loader_version: String,
    #[serde(default)]
    pub fullscreen: bool,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub close_on_launch: bool,

    // General
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default)]
    pub install_dir: String,

    // Appearance
    #[serde(default = "default_bg")]
    pub background: String,
    #[serde(default = "default_true")]
    pub animations: bool,
    #[serde(default)]
    pub transparencies: bool,
    #[serde(default = "default_accent")]
    pub accent_color: String,
}

fn default_instances() -> Vec<GameInstance> {
    vec![
        GameInstance {
            id: "soul-fabric".into(),
            name: "Soul Fabric".into(),
            description: "Instancia Fabric recomendada".into(),
            version: "1.21.1".into(),
            loader: "fabric".into(),
            loader_version: "0.16.14".into(),
            use_fabric: true,
            whitelist: false,
            cover: "fabric".into(),
            image: String::new(),
        },
        GameInstance {
            id: "soul-fabric-119".into(),
            name: "Soul Fabric 1.19".into(),
            description: "Fabric para Minecraft 1.19.2".into(),
            version: "1.19.2".into(),
            loader: "fabric".into(),
            loader_version: "0.14.21".into(),
            use_fabric: true,
            whitelist: false,
            cover: "fabric".into(),
            image: String::new(),
        },
        GameInstance {
            id: "soul-fabric-118".into(),
            name: "Soul Fabric 1.18".into(),
            description: "Fabric para Minecraft 1.18.2".into(),
            version: "1.18.2".into(),
            loader: "fabric".into(),
            loader_version: "0.14.21".into(),
            use_fabric: true,
            whitelist: false,
            cover: "fabric".into(),
            image: String::new(),
        },
        GameInstance {
            id: "vanilla-latest".into(),
            name: "Vanilla Latest".into(),
            description: "Minecraft vanilla sin mods".into(),
            version: "1.21.1".into(),
            loader: "vanilla".into(),
            loader_version: String::new(),
            use_fabric: false,
            whitelist: false,
            cover: "vanilla".into(),
            image: String::new(),
        },
        GameInstance {
            id: "modded-pack".into(),
            name: "Modded Pack".into(),
            description: "Pack con mods y whitelist".into(),
            version: "1.20.1".into(),
            loader: "fabric".into(),
            loader_version: "0.15.11".into(),
            use_fabric: true,
            whitelist: true,
            cover: "modded".into(),
            image: String::new(),
        },
    ]
}

fn default_accounts() -> Vec<Account> {
    vec![]
}
fn default_memory() -> u32 {
    4096
}
fn default_memory_min() -> u32 {
    1024
}
fn default_java_path() -> String {
    "java".to_string()
}
fn default_version() -> String {
    "1.21.1".to_string()
}
fn default_true() -> bool {
    true
}
fn default_fabric_loader() -> String {
    "0.16.14".to_string()
}
fn default_width() -> u32 {
    854
}
fn default_height() -> u32 {
    480
}
fn default_lang() -> String {
    "es".to_string()
}
fn default_theme() -> String {
    "dark".to_string()
}
fn default_bg() -> String {
    "default".to_string()
}
fn default_accent() -> String {
    "#4c8dff".to_string()
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            accounts: vec![],
            selected_account: None,
            instances: default_instances(),
            saved_skins: vec![],
            memory_mb: 4096,
            memory_min_mb: 1024,
            java_path: "java".to_string(),
            jvm_args: String::new(),
            minecraft_version: "1.21.1".to_string(),
            use_fabric: true,
            fabric_loader_version: "0.16.14".to_string(),
            fullscreen: false,
            width: 854,
            height: 480,
            close_on_launch: false,
            language: "es".to_string(),
            theme: "dark".to_string(),
            auto_start: false,
            auto_update: true,
            install_dir: String::new(),
            background: "default".to_string(),
            animations: true,
            transparencies: false,
            accent_color: "#3dd68c".to_string(),
        }
    }
}

impl LauncherConfig {
    fn config_path() -> PathBuf {
        let base = dirs::config_dir()
            .or_else(|| dirs::home_dir())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("SoulClient").join("config.json")
    }

    pub fn minecraft_dir() -> PathBuf {
        let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join(".soulclient").join(".minecraft")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(mut config) = serde_json::from_str::<Self>(&data) {
                    if config.instances.is_empty() {
                        config.instances = default_instances();
                    }
                    // Ensure at least one admin if accounts exist
                    if !config.accounts.is_empty()
                        && !config.accounts.iter().any(|a| a.role == "admin")
                    {
                        config.accounts[0].role = "admin".to_string();
                    }
                    return config;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}
