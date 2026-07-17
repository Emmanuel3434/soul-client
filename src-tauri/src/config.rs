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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstance {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default = "default_true")]
    pub use_fabric: bool,
    #[serde(default)]
    pub whitelist: bool,
    #[serde(default = "default_cover")]
    pub cover: String,
}

fn default_cover() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    #[serde(default = "default_accounts")]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub selected_account: Option<String>,
    #[serde(default = "default_instances")]
    pub instances: Vec<GameInstance>,
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
    #[serde(default = "default_java_path")]
    pub java_path: String,
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
}

fn default_instances() -> Vec<GameInstance> {
    vec![
        GameInstance {
            id: "soul-fabric".into(),
            name: "Soul Fabric".into(),
            version: "1.21.1".into(),
            use_fabric: true,
            whitelist: false,
            cover: "fabric".into(),
        },
        GameInstance {
            id: "vanilla-latest".into(),
            name: "Vanilla Latest".into(),
            version: "1.21.1".into(),
            use_fabric: false,
            whitelist: false,
            cover: "vanilla".into(),
        },
        GameInstance {
            id: "modded-pack".into(),
            name: "Modded Pack".into(),
            version: "1.20.1".into(),
            use_fabric: true,
            whitelist: true,
            cover: "modded".into(),
        },
    ]
}

fn default_accounts() -> Vec<Account> { vec![] }
fn default_memory() -> u32 { 2048 }
fn default_java_path() -> String { "java".to_string() }
fn default_version() -> String { "1.21.1".to_string() }
fn default_true() -> bool { true }
fn default_fabric_loader() -> String { "0.18.3".to_string() }
fn default_width() -> u32 { 854 }
fn default_height() -> u32 { 480 }

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            accounts: vec![],
            selected_account: None,
            instances: default_instances(),
            memory_mb: 2048,
            java_path: "java".to_string(),
            minecraft_version: "1.21.1".to_string(),
            use_fabric: true,
            fabric_loader_version: "0.18.3".to_string(),
            fullscreen: false,
            width: 854,
            height: 480,
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
