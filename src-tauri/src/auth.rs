use crate::config::Account;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

/// Application (client) ID from Azure Portal → App registrations.
const MS_CLIENT_ID: &str = "aa091f6a-5373-4285-b546-cf486228a522";

/// Personal Microsoft accounts only (`consumers` tenant is required for XboxLive.signin).
/// Azure: Mobile and desktop → Redirect URI = http://localhost:8443/callback
/// Allow public client flows = Yes.
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const REDIRECT_PORT: u16 = 8443;
const REDIRECT_PATH: &str = "/callback";

/// OIDC scopes + XboxLive.signin (required for Xbox → Minecraft; MBI_SSL is obsolete).
const MS_SCOPE: &str = "openid profile email offline_access XboxLive.signin";

const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

struct Pkce {
    verifier: String,
    challenge: String,
    state: String,
}

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

fn random_urlsafe(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_pkce() -> Pkce {
    // RFC 7636: verifier 43–128 chars from unreserved set
    let verifier = random_urlsafe(64);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    let state = random_urlsafe(24);
    Pkce {
        verifier,
        challenge,
        state,
    }
}

fn build_auth_url(pkce: &Pkce) -> String {
    let redirect = redirect_uri();
    format!(
        "{}?client_id={}&response_type=code&response_mode=query&scope={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256&state={}&prompt=select_account",
        MS_AUTHORIZE_URL,
        url_encode(MS_CLIENT_ID),
        url_encode(MS_SCOPE),
        url_encode(&redirect),
        url_encode(&pkce.challenge),
        url_encode(&pkce.state),
    )
}

/// Builds a one-shot authorize URL (without PKCE session). Prefer `login_with_microsoft_auto`.
pub fn get_microsoft_auth_url() -> String {
    let pkce = generate_pkce();
    build_auth_url(&pkce)
}

pub async fn login_with_microsoft_auto() -> Result<Account, String> {
    let pkce = generate_pkce();
    let expected_state = pkce.state.clone();
    let code_verifier = pkce.verifier.clone();

    let listener = TcpListener::bind(format!("127.0.0.1:{}", REDIRECT_PORT)).map_err(|e| {
        format!(
            "No se pudo iniciar el servidor local en el puerto {} (¿está ocupado?): {}",
            REDIRECT_PORT, e
        )
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let auth_url = build_auth_url(&pkce);
    open::that(&auth_url).map_err(|e| format!("No se pudo abrir el navegador: {}", e))?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        wait_for_auth_code(listener, &expected_state)
    })
    .await
    .map_err(|e| format!("Error interno: {}", e))??;

    login_with_microsoft_pkce(&code, &code_verifier).await
}

fn wait_for_auth_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(180);

    loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "Tiempo de espera agotado. En Azure → Authentication → Mobile and desktop agrega exactamente: {} | Allow public client flows = Yes | cuentas personales de Microsoft.",
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

                let target = request_line.split_whitespace().nth(1).unwrap_or("");
                if !target.starts_with(REDIRECT_PATH) {
                    let not_found =
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    writer.write_all(not_found.as_bytes()).ok();
                    writer.flush().ok();
                    continue;
                }

                match parse_callback(&request_line, expected_state) {
                    Ok(code) => {
                        let html = success_html();
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(),
                            html
                        );
                        writer.write_all(response.as_bytes()).ok();
                        writer.flush().ok();
                        return Ok(code);
                    }
                    Err(e) => {
                        let msg = format!(
                            "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0a0b0e;color:#fff;padding:40px'><h2>Error de login</h2><p>{}</p></body></html>",
                            html_escape(&e)
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
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("Error de conexión: {}", e)),
        }
    }
}

fn success_html() -> &'static str {
    r#"<!DOCTYPE html>
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
</div></body></html>"#
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn parse_callback(request_line: &str, expected_state: &str) -> Result<String, String> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split('?').nth(1).unwrap_or("");

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut error: Option<String> = None;
    let mut error_desc: Option<String> = None;

    for param in query.split('&') {
        let mut parts = param.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        let decoded = urlencoding_decode(value).unwrap_or_else(|| value.replace('+', " "));
        match key {
            "code" => code = Some(decoded),
            "state" => state = Some(decoded),
            "error" => error = Some(decoded),
            "error_description" => error_desc = Some(decoded),
            _ => {}
        }
    }

    if let Some(err) = error {
        let detail = error_desc.unwrap_or_else(|| err.clone());
        return Err(format!(
            "Microsoft rechazó el login ({err}): {detail}. Redirect URI en Azure debe ser exactamente {}.",
            redirect_uri()
        ));
    }

    let code = code.ok_or_else(|| {
        format!(
            "No se recibió el código. Esperábamos {}?code=...&state=...",
            redirect_uri()
        )
    })?;

    match state {
        Some(s) if s == expected_state => Ok(code),
        Some(_) => Err("State OAuth inválido (posible CSRF). Intenta de nuevo.".to_string()),
        None => Err("Microsoft no devolvió state. Intenta de nuevo.".to_string()),
    }
}

pub async fn login_with_microsoft(auth_code: &str) -> Result<Account, String> {
    // Legacy entry without PKCE — prefer login_with_microsoft_auto / pkce path.
    login_with_microsoft_pkce(auth_code, "").await
}

async fn login_with_microsoft_pkce(auth_code: &str, code_verifier: &str) -> Result<Account, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let ms_token = exchange_code_for_token(&client, auth_code, code_verifier).await?;
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

async fn exchange_code_for_token(
    client: &Client,
    auth_code: &str,
    code_verifier: &str,
) -> Result<String, String> {
    let redirect = redirect_uri();
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", MS_CLIENT_ID),
        ("code", auth_code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect.as_str()),
        ("scope", MS_SCOPE),
    ];
    if !code_verifier.is_empty() {
        form.push(("code_verifier", code_verifier));
    }

    let resp = client
        .post(MS_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("HTTP error al pedir token: {e}"))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Microsoft token error ({status}): {body_text}. Verifica Redirect URI = {redirect}, Allow public client flows = Yes, y que no uses el scope MBI_SSL."
        ));
    }

    let body: serde_json::Value =
        serde_json::from_str(&body_text).map_err(|e| format!("JSON token inválido: {e}"))?;
    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("No access_token en respuesta Microsoft: {body_text}"))
}

async fn get_xbox_token(client: &Client, ms_token: &str) -> Result<serde_json::Value, String> {
    // JWT access tokens from Azure AD v2 require the `d=` prefix for Xbox Live.
    let rps_ticket = if ms_token.starts_with("d=") {
        ms_token.to_string()
    } else {
        format!("d={ms_token}")
    };

    let payload = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": rps_ticket
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let resp = client
        .post(XBOX_AUTH_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Xbox Live auth failed ({status}): {body_text}. El access token debe incluir el scope XboxLive.signin."
        ));
    }

    serde_json::from_str(&body_text).map_err(|e| format!("JSON Xbox inválido: {e}"))
}

async fn get_xsts_token(
    client: &Client,
    xbox_data: &serde_json::Value,
) -> Result<(String, String), String> {
    let token = xbox_data
        .get("Token")
        .and_then(|t| t.as_str())
        .ok_or("No Token en respuesta de Xbox Live")?;

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
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "XSTS falló ({status}): {body_text}. La cuenta necesita perfil Xbox / Game Pass / Minecraft Java."
        ));
    }

    let body: serde_json::Value =
        serde_json::from_str(&body_text).map_err(|e| format!("JSON XSTS inválido: {e}"))?;

    let xsts = body
        .get("Token")
        .and_then(|t| t.as_str())
        .ok_or("No Token en respuesta XSTS")?
        .to_string();

    let uhs = body
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(|v| v.as_str())
        .ok_or("No user hash (uhs) en XSTS")?
        .to_string();

    Ok((uhs, xsts))
}

async fn get_minecraft_token(
    client: &Client,
    uhs: &str,
    xsts_token: &str,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "identityToken": format!("XBL3.0 x={uhs};{xsts_token}")
    });

    let resp = client
        .post(MC_AUTH_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Minecraft auth failed ({status}): {body_text}. Si ves NotPermitted, la App de Azure debe estar autorizada para Minecraft Services."
        ));
    }

    let body: serde_json::Value =
        serde_json::from_str(&body_text).map_err(|e| format!("JSON Minecraft inválido: {e}"))?;
    body.get("access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("No access_token en respuesta Minecraft: {body_text}"))
}

async fn get_minecraft_profile(client: &Client, mc_token: &str) -> Result<(String, String), String> {
    let resp = client
        .get(MC_PROFILE_URL)
        .bearer_auth(mc_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "No se encontró perfil de Minecraft ({status}): {body_text}. Asegúrate de tener Minecraft Java Edition en esa cuenta."
        ));
    }

    let body: serde_json::Value =
        serde_json::from_str(&body_text).map_err(|e| format!("JSON perfil inválido: {e}"))?;
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
        return Err("Ese nombre ya está en uso. Elige un nombre diferente.".to_string());
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
