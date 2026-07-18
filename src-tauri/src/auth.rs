use crate::config::Account;
use reqwest::Client;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

const MS_CLIENT_ID: &str = "853ca6f9-26ca-457a-b132-ed0afde994e1";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const REDIRECT_PORT: u16 = 8443;
const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

fn redirect_uri() -> String {
    format!("http://localhost:{}", REDIRECT_PORT)
}

pub fn get_microsoft_auth_url() -> String {
    format!(
        "{}?client_id={}&response_type=code&scope=service%%3A%%3Auser.auth.xboxlive.com%%3A%%3AMBI_SSL&redirect_uri={}",
        MS_AUTHORIZE_URL, MS_CLIENT_ID, redirect_uri()
    )
}

pub async fn login_with_microsoft_auto() -> Result<Account, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", REDIRECT_PORT))
        .map_err(|e| format!("No se pudo iniciar servidor local en puerto {}: {}", REDIRECT_PORT, e))?;

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let auth_url = get_microsoft_auth_url();
    open::that(&auth_url).map_err(|e| format!("No se pudo abrir el navegador: {}", e))?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(120);

        loop {
            if start.elapsed() > timeout {
                return Err("Tiempo de espera agotado. Intenta de nuevo.".to_string());
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    let reader = BufReader::new(&stream);
                    let mut writer = std::io::BufWriter::new(&stream);

                    let mut path = String::new();
                    for line in reader.lines() {
                        let line = line.map_err(|e| e.to_string())?;
                        if path.is_empty() {
                            path = line;
                            continue;
                        }
                        if line.is_empty() {
                            break;
                        }
                    }

                    let code = parse_code_from_redirect(&path)?;

                    let html = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SoulClient</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
  .card { text-align: center; padding: 40px; background: #16213e; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .check { font-size: 64px; margin-bottom: 16px; }
  h2 { margin: 0 0 8px; color: #4c8dff; }
  p { color: #aaa; margin: 0; }
</style></head><body>
<div class="card">
  <div class="check">&#10003;</div>
  <h2>Login exitoso</h2>
  <p>Puedes cerrar esta ventana y volver al launcher.</p>
</div></body></html>"#;

                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );

                    writer.write_all(response.as_bytes()).ok();
                    writer.flush().ok();

                    return Ok(code);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => {
                    return Err(format!("Error de conexión: {}", e));
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Error interno: {}", e))??;

    login_with_microsoft(&code).await
}

fn parse_code_from_redirect(path: &str) -> Result<String, String> {
    let query = path.split_whitespace().nth(1).unwrap_or("");
    let query = query.split('?').nth(1).unwrap_or("");

    for param in query.split('&') {
        let mut parts = param.splitn(2, '=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "code" {
                return Ok(value.to_string());
            }
        }
    }

    Err("No se recibió el código de autorización. Asegúrate de haber iniciado sesión con la cuenta correcta.".to_string())
}

pub async fn login_with_microsoft(auth_code: &str) -> Result<Account, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let ms_token = get_microsoft_token(&client, auth_code).await?;
    let xbox_data = get_xbox_token(&client, &ms_token).await?;
    let xsts_token = get_xsts_token(&client, &xbox_data).await?;
    let mc_token = get_minecraft_token(&client, &xsts_token).await?;
    let (profile_id, profile_name) = get_minecraft_profile(&client, &mc_token).await?;

    Ok(Account {
        name: profile_name,
        id: profile_id,
        account_type: "premium".to_string(),
        token: mc_token,
        role: "user".to_string(),
        skin: String::new(),
    })
}

async fn get_microsoft_token(client: &Client, auth_code: &str) -> Result<String, String> {
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("code", auth_code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", &redirect_uri()),
        ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
    ];
    let resp = client
        .post(MS_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Microsoft token error ({}): {}", status, body));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in Microsoft response".to_string())
}

async fn get_xbox_token(client: &Client, ms_token: &str) -> Result<serde_json::Value, String> {
    let payload = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": ms_token
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let resp = client
        .post(XBOX_AUTH_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Xbox auth failed: {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn get_xsts_token(client: &Client, xbox_data: &serde_json::Value) -> Result<String, String> {
    let token = xbox_data
        .get("IssueAfter")
        .and_then(|ia| ia.get("Token"))
        .and_then(|t| t.as_str())
        .or_else(|| xbox_data.get("Token").and_then(|t| t.as_str()))
        .ok_or("No token in Xbox response")?;

    let payload = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    let resp = client
        .post(XSTS_AUTH_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(
            "XSTS authentication failed. The Microsoft account may not have an Xbox profile / Game Pass.".to_string(),
        );
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    body.get("Token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No token in XSTS response".to_string())
}

async fn get_minecraft_token(client: &Client, xsts_token: &str) -> Result<String, String> {
    let payload = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};", xsts_token)
    });
    let resp = client
        .post(MC_AUTH_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Minecraft auth failed: {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    body.get("access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in MC auth response".to_string())
}

async fn get_minecraft_profile(client: &Client, mc_token: &str) -> Result<(String, String), String> {
    let resp = client
        .get(MC_PROFILE_URL)
        .bearer_auth(mc_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err("No Minecraft profile found for this Microsoft account. Make sure you own Minecraft Java Edition.".to_string());
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("No profile id")?
        .to_string();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("No profile name")?
        .to_string();
    Ok((id, name))
}

pub fn is_username_taken(username: &str, accounts: &[Account]) -> bool {
    let needle = username.trim().to_lowercase();
    accounts
        .iter()
        .any(|a| a.name.trim().to_lowercase() == needle)
}

pub fn login_offline(username: &str, existing_accounts: &[Account]) -> Result<Account, String> {
    let username = username.trim();
    if username.len() < 3 || username.len() > 16 {
        return Err("El nombre debe tener entre 3 y 16 caracteres".to_string());
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Solo letras, números y guion bajo".to_string());
    }
    if is_username_taken(username, existing_accounts) {
        return Err(
            "Ese nombre ya está en uso. Elige un nombre diferente.".to_string(),
        );
    }
    let offline_uuid = uuid::Uuid::new_v3(&uuid::Uuid::NAMESPACE_DNS, username.as_bytes());
    Ok(Account {
        name: username.to_string(),
        id: offline_uuid.as_simple().to_string(),
        account_type: "offline".to_string(),
        token: "0".to_string(),
        role: "user".to_string(),
        skin: String::new(),
    })
}
