use crate::config::LauncherConfig;
use reqwest::Client;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinSet;

const VERSION_MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META_URL: &str = "https://meta.fabricmc.net/v2/versions";
const FABRIC_MAVEN: &str = "https://maven.fabricmc.net";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, serde::Deserialize)]
struct VersionManifest {
    versions: Vec<VersionRef>,
}

#[derive(Debug, serde::Deserialize)]
struct VersionRef {
    id: String,
    url: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "downloads")]
    pub downloads: VersionDownloads,
    #[serde(default)]
    pub libraries: Vec<Library>,
    #[serde(default)]
    pub assetIndex: Option<AssetIndex>,
    #[serde(default)]
    pub mainClass: Option<String>,
    #[serde(default)]
    pub arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct VersionDownloads {
    pub client: DownloadEntry,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct DownloadEntry {
    pub url: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Library {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,
    #[serde(default)]
    pub rules: Option<Vec<Rule>>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct LibraryDownloads {
    #[serde(default)]
    pub artifact: Option<Artifact>,
    #[serde(default)]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Artifact {
    pub path: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Rule {
    pub action: Option<String>,
    #[serde(default)]
    pub os: Option<serde_json::Value>,
    #[serde(default)]
    pub features: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AssetIndex {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AssetsIndex {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FabricLoaderEntry {
    version: String,
}

pub struct Downloader {
    client: Client,
    mc_dir: PathBuf,
}

impl Downloader {
    pub fn new() -> Self {
        let mc_dir = LauncherConfig::minecraft_dir();
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap(),
            mc_dir,
        }
    }

    fn versions_dir(&self) -> PathBuf { self.mc_dir.join("versions") }
    fn libraries_dir(&self) -> PathBuf { self.mc_dir.join("libraries") }
    fn assets_dir(&self) -> PathBuf { self.mc_dir.join("assets") }
    fn assets_index_dir(&self) -> PathBuf { self.assets_dir().join("indexes") }
    fn assets_objects_dir(&self) -> PathBuf { self.assets_dir().join("objects") }

    fn ensure_dirs(&self) {
        for d in &[
            self.versions_dir(),
            self.libraries_dir(),
            self.assets_dir(),
            self.assets_index_dir(),
            self.assets_objects_dir(),
        ] {
            let _ = fs::create_dir_all(d);
        }
    }

    fn sha1_file(path: &Path) -> Option<String> {
        let data = fs::read(path).ok()?;
        let mut hasher = Sha1::new();
        hasher.update(&data);
        Some(hex::encode(hasher.finalize()))
    }

    async fn download_file(
        client: &Client,
        url: &str,
        dest: &Path,
        expected_sha1: Option<&str>,
        expected_size: Option<u64>,
    ) -> Result<(), String> {
        if dest.exists() {
            if let (Some(sha), Some(size)) = (expected_sha1, expected_size) {
                if dest.metadata().map(|m| m.len() == size).unwrap_or(false) {
                    if Self::sha1_file(dest).as_deref() == Some(sha) {
                        return Ok(());
                    }
                }
            }
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
        let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        if let Some(sha) = expected_sha1 {
            if Self::sha1_file(dest).as_deref() != Some(sha) {
                let _ = fs::remove_file(dest);
                return Err(format!("SHA1 mismatch for {}", dest.display()));
            }
        }
        Ok(())
    }

    pub async fn get_version_info(&self, version_id: &str) -> Result<VersionInfo, String> {
        let resp = self.client.get(VERSION_MANIFEST_URL).send().await.map_err(|e| e.to_string())?;
        let manifest: VersionManifest = resp.json().await.map_err(|e| e.to_string())?;
        let version_ref = manifest.versions.iter().find(|v| v.id == version_id)
            .ok_or_else(|| format!("Version {} not found", version_id))?;
        let resp = self.client.get(&version_ref.url).send().await.map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }

    async fn download_version_jar(&self, version_id: &str, progress: &Arc<Mutex<Vec<DownloadProgress>>>) -> Result<VersionInfo, String> {
        let info = self.get_version_info(version_id).await?;
        let version_dir = self.versions_dir().join(version_id);
        fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;

        let jar_path = version_dir.join(format!("{}.jar", version_id));
        let json_path = version_dir.join(format!("{}.json", version_id));

        Self::emit(progress, 0, 1, format!("Downloading {}.jar...", version_id)).await;

        Self::download_file(
            &self.client,
            &info.downloads.client.url,
            &jar_path,
            Some(&info.downloads.client.sha1),
            Some(info.downloads.client.size),
        ).await?;

        fs::write(&json_path, serde_json::to_string(&info).unwrap()).map_err(|e| e.to_string())?;
        Ok(info)
    }

    async fn download_libraries(&self, info: &VersionInfo, progress: &Arc<Mutex<Vec<DownloadProgress>>>) -> Result<(), String> {
        let libs_dir = self.libraries_dir();
        let mut download_tasks: Vec<(String, PathBuf, Option<String>, Option<u64>)> = vec![];

        for lib in &info.libraries {
            if let Some(ref downloads) = lib.downloads {
                if let Some(ref artifact) = downloads.artifact {
                    let path = libs_dir.join(&artifact.path);
                    if !path.exists() {
                        download_tasks.push((
                            artifact.url.clone(),
                            path,
                            artifact.sha1.clone(),
                            artifact.size,
                        ));
                    }
                }
                if let Some(ref natives) = lib.natives {
                    if let Some(classifiers) = &downloads.classifiers {
                        for (_platform, native_key) in natives {
                            if let Some(native) = classifiers.get(native_key) {
                                let path = libs_dir.join(&native.path);
                                if !path.exists() {
                                    download_tasks.push((
                                        native.url.clone(),
                                        path,
                                        native.sha1.clone(),
                                        native.size,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        let total = download_tasks.len() as u64;
        if total == 0 {
            Self::emit(progress, 0, 0, "All libraries already downloaded".to_string()).await;
            return Ok(());
        }

        let completed = Arc::new(AtomicU64::new(0));

        let mut join_set = JoinSet::new();
        for (url, path, sha, size) in download_tasks {
            let client = self.client.clone();
            let completed = completed.clone();
            let progress = progress.clone();

            join_set.spawn(async move {
                let result = Self::download_file(&client, &url, &path, sha.as_deref(), size).await;
                let count = completed.fetch_add(1, Ordering::Relaxed) + 1;

                if count % 50 == 0 || count == total {
                    Self::emit(&progress, count, total, format!("Downloading libraries ({}/{})", count, total)).await;
                }
                result
            });
        }

        while let Some(result) = join_set.join_next().await {
            if let Ok(Err(e)) = result {
                return Err(e);
            }
        }

        Ok(())
    }

    async fn download_assets(&self, info: &VersionInfo, progress: &Arc<Mutex<Vec<DownloadProgress>>>) -> Result<(), String> {
        let asset_index = match &info.assetIndex {
            Some(ai) => ai,
            None => return Ok(()),
        };

        let index_path = self.assets_index_dir().join(format!("{}.json", asset_index.id));
        let resp = self.client.get(&asset_index.url).send().await.map_err(|e| e.to_string())?;
        let body = resp.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&index_path, &body).map_err(|e| e.to_string())?;

        let assets_index: AssetsIndex = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        let objects_dir = self.assets_objects_dir();
        let mut download_tasks: Vec<(String, PathBuf, String)> = vec![];

        for (_name, obj) in &assets_index.objects {
            let hash = &obj.hash;
            let subdir = &hash[..2];
            let dest = objects_dir.join(subdir).join(hash);
            if !dest.exists() {
                let url = format!("https://resources.download.minecraft.net/{}/{}", subdir, hash);
                download_tasks.push((url, dest, hash.clone()));
            }
        }

        let total = download_tasks.len() as u64;
        if total == 0 {
            Self::emit(progress, 0, 0, "All assets already downloaded".to_string()).await;
            return Ok(());
        }

        Self::emit(progress, 0, total, format!("Downloading {} assets...", total)).await;

        let completed = Arc::new(AtomicU64::new(0));

        let mut join_set = JoinSet::new();
        for (url, path, sha) in download_tasks {
            let client = self.client.clone();
            let completed = completed.clone();
            let progress = progress.clone();

            join_set.spawn(async move {
                let result = Self::download_file(&client, &url, &path, Some(&sha), None).await;
                let count = completed.fetch_add(1, Ordering::Relaxed) + 1;

                if count % 500 == 0 || count == total {
                    Self::emit(&progress, count, total, format!("Downloading assets ({}/{})", count, total)).await;
                }
                result
            });
        }

        while let Some(result) = join_set.join_next().await {
            if let Ok(Err(e)) = result {
                return Err(e);
            }
        }

        Self::emit(progress, total, total, "Assets downloaded".to_string()).await;
        Ok(())
    }

    async fn extract_natives(&self, info: &VersionInfo, progress: &Arc<Mutex<Vec<DownloadProgress>>>) -> Result<(), String> {
        let natives_dir = self.versions_dir().join(&info.id).join("natives");
        fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;

        for lib in &info.libraries {
            if let Some(ref natives) = lib.natives {
                let native_key = natives.get("windows")
                    .or_else(|| natives.get("linux"))
                    .or_else(|| natives.get("osx"));

                if let Some(key) = native_key {
                    if let Some(ref downloads) = lib.downloads {
                        if let Some(classifiers) = &downloads.classifiers {
                            if let Some(native) = classifiers.get(key) {
                                let jar_path = self.libraries_dir().join(&native.path);
                                if jar_path.exists() {
                                    let _ = extract_natives_from_jar(&jar_path, &natives_dir);
                                }
                            }
                        }
                    }
                }
            }
        }

        Self::emit(progress, 1, 1, "Natives extracted".to_string()).await;
        Ok(())
    }

    pub async fn download_fabric(&self, game_version: &str, loader_version: &str, progress: &Arc<Mutex<Vec<DownloadProgress>>>) -> Result<String, String> {
        Self::emit(progress, 0, 3, "Downloading Fabric Loader...".to_string()).await;

        let url = format!("{}/loader/{}/{}", FABRIC_META_URL, game_version, loader_version);
        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        let loaders: Vec<FabricLoaderEntry> = resp.json().await.map_err(|e| e.to_string())?;

        let target = loaders.first().ok_or("No Fabric Loader found for this version")?;

        Self::emit(progress, 1, 3, "Downloading Fabric profile...".to_string()).await;

        let profile_url = format!(
            "{}/net/fabricmc/fabric-loader/{}/{}/fabric-loader-{}.json",
            FABRIC_MAVEN, target.version, target.version, target.version
        );
        let resp = self.client.get(&profile_url).send().await.map_err(|e| e.to_string())?;
        let fabric_profile: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        Self::emit(progress, 2, 3, "Setting up Fabric...".to_string()).await;

        let version_id = format!("fabric-loader-{}-{}", target.version, game_version);
        let version_dir = self.versions_dir().join(&version_id);
        fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;

        let base_json_path = self.versions_dir().join(game_version).join(format!("{}.json", game_version));
        let mut base_profile: serde_json::Value = if base_json_path.exists() {
            let data = fs::read_to_string(&base_json_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        base_profile["id"] = serde_json::json!(version_id);
        base_profile["inheritsFrom"] = serde_json::json!(game_version);

        if let Some(main_class) = fabric_profile.get("mainClass") {
            base_profile["mainClass"] = main_class.clone();
        }

        if let Some(fabric_libs) = fabric_profile.get("libraries") {
            let mut merged_libs: Vec<serde_json::Value> = Vec::new();
            if let Some(existing) = base_profile.get("libraries").and_then(|v| v.as_array()) {
                merged_libs.extend(existing.iter().cloned());
            }
            if let Some(new_libs) = fabric_libs.as_array() {
                merged_libs.extend(new_libs.iter().cloned());
            }
            base_profile["libraries"] = serde_json::json!(merged_libs);
        }

        let profile_path = version_dir.join(format!("{}.json", version_id));
        fs::write(&profile_path, serde_json::to_string_pretty(&base_profile).unwrap()).map_err(|e| e.to_string())?;

        Self::emit(progress, 3, 3, format!("Fabric Loader {} installed", target.version)).await;

        Ok(version_id)
    }

    pub async fn download_all(
        &self,
        version_id: &str,
        use_fabric: bool,
        loader_version: &str,
        progress: Arc<Mutex<Vec<DownloadProgress>>>,
    ) -> Result<serde_json::Value, String> {
        self.ensure_dirs();

        let version_info = self.download_version_jar(version_id, &progress).await?;
        self.download_libraries(&version_info, &progress).await?;
        self.download_assets(&version_info, &progress).await?;
        self.extract_natives(&version_info, &progress).await?;

        let fabric_version_id = if use_fabric {
            Some(self.download_fabric(version_id, loader_version, &progress).await?)
        } else {
            None
        };

        Ok(serde_json::json!({
            "version_info": version_info,
            "fabric_version_id": fabric_version_id
        }))
    }

    async fn emit(progress: &Arc<Mutex<Vec<DownloadProgress>>>, downloaded: u64, total: u64, message: String) {
        let mut prog = progress.lock().await;
        prog.push(DownloadProgress { downloaded, total, message });
    }
}

fn extract_natives_from_jar(jar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.starts_with("natives/") || name.starts_with("META-INF/") {
            continue;
        }
        if name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") || name.ends_with(".jnilib") {
            let out_path = dest_dir.join(Path::new(&name).file_name().unwrap());
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
