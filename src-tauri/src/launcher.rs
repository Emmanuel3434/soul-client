use crate::config::{Account, LauncherConfig};
use crate::downloader::VersionInfo;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub struct GameLauncher {
    mc_dir: PathBuf,
}

impl GameLauncher {
    pub fn new() -> Self {
        Self {
            mc_dir: LauncherConfig::minecraft_dir(),
        }
    }

    fn versions_dir(&self) -> PathBuf { self.mc_dir.join("versions") }
    fn libraries_dir(&self) -> PathBuf { self.mc_dir.join("libraries") }
    fn assets_dir(&self) -> PathBuf { self.mc_dir.join("assets") }

    fn name_to_path(name: &str) -> String {
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() < 3 {
            return name.replace('.', "/").replace(':', "/");
        }
        let group = parts[0].replace('.', "/");
        let artifact = parts[1];
        let version = parts[2];
        let classifier = parts.get(3);
        let filename = if let Some(c) = classifier {
            format!("{}-{}-{}.jar", artifact, version, c)
        } else {
            format!("{}-{}.jar", artifact, version)
        };
        format!("{}/{}/{}/{}", group, artifact, version, filename)
    }

    fn build_classpath(&self, version_info: &VersionInfo, fabric_version_id: Option<&str>) -> String {
        let mut libs: Vec<String> = vec![];

        let game_jar = self.versions_dir().join(&version_info.id).join(format!("{}.jar", version_info.id));
        libs.push(game_jar.to_string_lossy().to_string());

        for lib in &version_info.libraries {
            if let Some(ref downloads) = lib.downloads {
                if let Some(ref artifact) = downloads.artifact {
                    let path = self.libraries_dir().join(&artifact.path);
                    libs.push(path.to_string_lossy().to_string());
                    continue;
                }
            }
            let path_str = Self::name_to_path(&lib.name);
            let full_path = self.libraries_dir().join(&path_str);
            if full_path.exists() {
                libs.push(full_path.to_string_lossy().to_string());
            }
        }

        if let Some(fab_id) = fabric_version_id {
            let inherit_json = self.versions_dir().join(&version_info.id).join(format!("{}.json", version_info.id));
            Self::collect_libs_from_json(&inherit_json, &self.libraries_dir(), &mut libs);

            let fabric_json = self.versions_dir().join(fab_id).join(format!("{}.json", fab_id));
            Self::collect_libs_from_json(&fabric_json, &self.libraries_dir(), &mut libs);
        }

        #[cfg(target_os = "windows")]
        { libs.join(";") }
        #[cfg(not(target_os = "windows"))]
        { libs.join(":") }
    }

    fn collect_libs_from_json(json_path: &Path, libs_dir: &Path, libs: &mut Vec<String>) {
        if !json_path.exists() {
            return;
        }
        if let Ok(data) = fs::read_to_string(json_path) {
            if let Ok(profile) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(libs_val) = profile.get("libraries").and_then(|v| v.as_array()) {
                    for lib in libs_val {
                        if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
                            let path_str = Self::name_to_path(name);
                            let full_path = libs_dir.join(&path_str);
                            let path_string = full_path.to_string_lossy().to_string();
                            if full_path.exists() && !libs.contains(&path_string) {
                                libs.push(path_string);
                            }
                        }
                    }
                }
            }
        }
    }

    fn get_natives_dir(&self, version_id: &str) -> PathBuf {
        self.versions_dir().join(version_id).join("natives")
    }

    fn get_main_class(&self, version_info: &VersionInfo, fabric_version_id: Option<&str>) -> String {
        if let Some(fab_id) = fabric_version_id {
            let fabric_json = self.versions_dir().join(fab_id).join(format!("{}.json", fab_id));
            if fabric_json.exists() {
                if let Ok(data) = fs::read_to_string(&fabric_json) {
                    if let Ok(profile) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let Some(mc) = profile.get("mainClass").and_then(|v| v.as_str()) {
                            return mc.to_string();
                        }
                    }
                }
            }
        }
        version_info.mainClass.clone().unwrap_or_default()
    }

    pub fn launch(
        &self,
        account: &Account,
        version_info: &VersionInfo,
        fabric_version_id: Option<&str>,
        config: &LauncherConfig,
    ) -> Result<u32, String> {
        let launch_version_id = fabric_version_id.unwrap_or(&version_info.id);

        let classpath = self.build_classpath(version_info, fabric_version_id);
        let natives_dir = self.get_natives_dir(&version_info.id);
        let main_class = self.get_main_class(version_info, fabric_version_id);
        let asset_index = version_info.assetIndex.as_ref().map(|ai| ai.id.as_str()).unwrap_or("legacy");

        if main_class.is_empty() {
            return Err("Could not determine main class".to_string());
        }

        let mut args = vec![
            format!("-Xmx{}M", config.memory_mb),
            format!("-Xms{}M", std::cmp::min(config.memory_mb / 2, 512)),
            format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
            "-Dminecraft.launcher.brand=SoulClient".to_string(),
            "-Dminecraft.launcher.version=1.0".to_string(),
            "-cp".to_string(),
            classpath,
            main_class,
        ];

        let game_args = vec![
            format!("--username={}", account.name),
            format!("--version={}", launch_version_id),
            format!("--gameDir={}", self.mc_dir.to_string_lossy()),
            format!("--assetsDir={}", self.assets_dir().to_string_lossy()),
            format!("--assetIndex={}", asset_index),
            format!("--uuid={}", account.id),
            format!("--userType={}", account.account_type),
            format!("--accessToken={}", account.token),
            format!("--width={}", config.width),
            format!("--height={}", config.height),
        ];

        args.extend(game_args);

        if config.fullscreen {
            args.push("--fullscreen".to_string());
        }

        let child = Command::new(&config.java_path)
            .args(&args)
            .current_dir(&self.mc_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch Java: {}. Make sure Java is installed and in your PATH.", e))?;

        Ok(child.id())
    }
}
