#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod config;
mod downloader;
mod launcher;

use config::{Account, LauncherConfig};
use downloader::Downloader;
use launcher::GameLauncher;
use std::sync::Arc;
use tokio::sync::Mutex;

struct AppState {
    download_progress: Arc<Mutex<Vec<downloader::DownloadProgress>>>,
}

#[tauri::command]
fn load_config() -> LauncherConfig {
    LauncherConfig::load()
}

#[tauri::command]
fn save_config(config: LauncherConfig) -> Result<(), String> {
    config.save()
}

#[tauri::command]
fn get_microsoft_auth_url() -> String {
    auth::get_microsoft_auth_url()
}

#[tauri::command]
async fn login_microsoft(auth_code: String) -> Result<Account, String> {
    auth::login_with_microsoft(&auth_code).await
}

#[tauri::command]
fn login_offline(username: String) -> Result<Account, String> {
    auth::login_offline(&username)
}

#[tauri::command]
async fn download_game(
    state: tauri::State<'_, AppState>,
    version_id: String,
    use_fabric: bool,
    fabric_loader_version: String,
) -> Result<serde_json::Value, String> {
    let downloader = Downloader::new();
    let progress = Arc::new(Mutex::new(Vec::new()));

    {
        let mut state_progress = state.download_progress.lock().await;
        *state_progress = Vec::new();
    }

    let result = downloader
        .download_all(&version_id, use_fabric, &fabric_loader_version, progress.clone())
        .await?;

    {
        let mut state_progress = state.download_progress.lock().await;
        *state_progress = progress.lock().await.clone();
    }

    Ok(result)
}

#[tauri::command]
async fn get_download_progress(state: tauri::State<'_, AppState>) -> Vec<downloader::DownloadProgress> {
    state.download_progress.lock().await.clone()
}

#[tauri::command]
fn launch_game(
    account: Account,
    game_data: serde_json::Value,
    config: LauncherConfig,
) -> Result<u32, String> {
    let version_info: downloader::VersionInfo = serde_json::from_value(
        game_data
            .get("version_info")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| format!("Invalid version data: {}", e))?;

    let fabric_version_id = game_data
        .get("fabric_version_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let game_launcher = GameLauncher::new();
    game_launcher.launch(&account, &version_info, fabric_version_id.as_deref(), &config)
}

#[tauri::command]
fn open_mods_folder() -> Result<(), String> {
    let mc_dir = LauncherConfig::minecraft_dir();
    let mods_dir = mc_dir.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    open::that(&mods_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_installed_versions() -> Vec<serde_json::Value> {
    let mc_dir = LauncherConfig::minecraft_dir();
    let versions_dir = mc_dir.join("versions");
    let mut versions = vec![];

    if let Ok(entries) = std::fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let version_dir = entry.path();
            let json_path = version_dir.join(format!("{}.json", name));
            let jar_path = version_dir.join(format!("{}.jar", name));

            if json_path.exists() {
                versions.push(serde_json::json!({
                    "id": name,
                    "has_jar": jar_path.exists(),
                    "is_fabric": name.contains("fabric-loader"),
                }));
            }
        }
    }
    versions
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            download_progress: Arc::new(Mutex::new(Vec::new())),
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_microsoft_auth_url,
            login_microsoft,
            login_offline,
            download_game,
            get_download_progress,
            launch_game,
            open_mods_folder,
            get_installed_versions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SoulClient");
}
