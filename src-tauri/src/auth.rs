use crate::config::Account;
use reqwest::Client;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

/// Application (client) ID from Azure Portal → App registrations.
const MS_CLIENT_ID: &str = "853ca6f9-26ca-457a-b132-ed0afde994e1";

/// Personal Microsoft accounts (Xbox / Minecraft). Your Azure app MUST allow
/// "Personal Microsoft accounts" (or org + personal) and register redirect URI
/// exactly: http://localhost:8443/callback under Mobile and desktop applications.
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const REDIRECT_PORT: u16 = 8443;
const REDIRECT_PATH: &str = "/callback";
const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MS_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

fn redirect_uri() -> String {
    format!("http://localhost:{}{}", REDIRECT_PORT, REDIRECT_PATH)
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn get_microsoft_auth_url() -> String {
    let redirect = redirect_uri();
    format!(
        "{}?client_id={}&response_type=code&response_mode=query&scope={}&redirect_uri={}&prompt=select_account",
        MS_AUTHORIZE_URL,
        url_encode(MS_CLIENT_ID),
        url_encode(MS_SCOPE),
        url_encode(&redirect),
    )
}

pub async fn login_with_microsoft_auto() -> Result<Account, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", REDIRECT_PORT)).map_err(|e| {
        format!(
            "No se pudo iniciar el servidor local en el puerto {} (¿está ocupado?): {}",
            REDIRECT_PORT, e
        )
    })?;

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let auth_url = get_microsoft_auth_url();
    open::that(&auth_url).map_err(|e| format!("No se pudo abrir el navegador: {}", e))?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(180);

        loop {
            if start.elapsed() > timeout {
                return Err(format!(
                    "Tiempo de espera agotado. En Azure → Authentication → Mobile and desktop agrega exactamente: {}  | Allow public client flows = Yes | cuentas personales de Microsoft.",
                    redirect_uri()
                ));
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    let reader = BufReader::new(&stream);
                    let mut writer = std::io::BufWriter::new(&stream);

                    let mut request_line = String::new();
                    for line in reader.lines() {
                        let line = line.map_err(|e| e.to_string())?;
                        if request_line.is_empty() {
                            request_line = line;
                            continue;
                        }
                        if line.is_empty() {
                            break;
                        }
                    }

                    // Ignore favicon / other noise; only /callback completes login.
                    let target = request_line.split_whitespace().nth(1).unwrap_or("");
                    if !target.starts_with(REDIRECT_PATH) {
                        let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        writer.write_all(not_found.as_bytes()).ok();
                        writer.flush().ok();
                        continue;
                    }

                    let code = match parse_code_from_redirect(&request_line) {
                        Ok(c) => c,
                        Err(e) => {
                            let msg = format!(
                                "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0a0b0e;color:#fff;padding:40px'><h2>Error de login</h2><p>{}</p></body></html>",
                                e
                            );
                            let response = format!(
                                "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                msg.len(),
                                msg
                            );
                            writer.write_all(response.as_bytes()).ok();
                            writer.flush().ok();
                            return Err(e);
                        }
                    };

                    let html = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SoulClient</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0b0e; color: #fff; }
  .card { text-align: center; padding: 40px; background: #12141a; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .check { font-size: 64px; margin-bottom: 16px; color: #4c8dff; }
  h2 { margin: 0 0 8px; color: #4c8dff; }
  p { color: #9aa3b5; margin: 0; }
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

    let mut error_desc = None;
    for param in query.split('&') {
        let mut parts = param.splitn(2, '=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "code" {
                return Ok(value.to_string());
            }
            if key == "error_description" || key == "error" {
                error_desc = Some(
                    urlencoding_decode(value).unwrap_or_else(|| value.replace('+', " ")),
                );
            }
        }
    }

    if let Some(msg) = error_desc {
        return Err(format!(
            "Microsoft rechazó el login: {}. En Azure agrega exactamente {} (Mobile and desktop) y permite cuentas personales de Microsoft.",
            msg,
            redirect_uri()
        ));
    }

    Err(format!(
        "No se recibió el código. Esperábamos {}?code=... En Azure: Redirect URI = {} | Allow public client flows = Yes.",
        redirect_uri(),
        redirect_uri()
    ))
}

fn urlencoding_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

pub async fn login_with_microsoft(auth_code: &str) -> Result<Account, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let ms_token = get_microsoft_token(&client, auth_code).await?;
    let xbox_data = get_xbox_token(&client, &ms_token).await?;
    let (uhs, xsts_token) = get_xsts_token(&client, &xbox_data).await?;
    let mc_token = get_minecraft_token(&client, &uhs, &xsts_token).await?;
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
    let redirect = redirect_uri();
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("code", auth_code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect.as_str()),
        ("scope", MS_SCOPE),
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
        return Err(format!(
            "Microsoft token error ({}): {}. Verifica que el Redirect URI en Azure sea exactamente {} y que Allow public client flows esté en Yes.",
            status, body, redirect
        ));
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
            "RpsTicket": format!("d={}", ms_token)
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
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Xbox auth failed: {}", body));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn get_xsts_token(
    client: &Client,
    xbox_data: &serde_json::Value,
) -> Result<(String, String), String> {
    let token = xbox_data
        .get("Token")
        .and_then(|t| t.as_str())
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
            "XSTS authentication failed. La cuenta Microsoft necesita un perfil Xbox y Minecraft Java Edition."
                .to_string(),
        );
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let xsts = body
        .get("Token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "No token in XSTS response".to_string())?
        .to_string();

    let uhs = body
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No user hash (uhs) in XSTS response".to_string())?
        .to_string();

    Ok((uhs, xsts))
}

async fn get_minecraft_token(
    client: &Client,
    uhs: &str,
    xsts_token: &str,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
    });
    let resp = client
        .post(MC_AUTH_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Minecraft auth failed: {}", body));
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
        return Err("No se encontró perfil de Minecraft. Asegúrate de tener Minecraft Java Edition en esa cuenta Microsoft.".to_string());
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

    let id = uuid::Uuid::new_v3(&uuid::Uuid::NAMESPACE_DNS, username.as_bytes()).to_string();
    Ok(Account {
        name: username.to_string(),
        id,
        account_type: "offline".to_string(),
        token: String::new(),
        role: "user".to_string(),
        skin: String::new(),
    })
}
