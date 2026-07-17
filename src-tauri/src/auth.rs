use crate::config::Account;
use reqwest::Client;

const MS_CLIENT_ID: &str = "00000000402b5328";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_AUTHORIZE_URL: &str = "https://login.live.com/authorize.srf";
const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

pub fn get_microsoft_auth_url() -> String {
    format!(
        "{}?client_id={}&response_type=code&scope=service%%3A%%3Auser.auth.xboxlive.com%%3A%%3AMBI_SSL&redirect_uri=https://login.live.com/owlknie.srf",
        MS_AUTHORIZE_URL, MS_CLIENT_ID
    )
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
    })
}

async fn get_microsoft_token(client: &Client, auth_code: &str) -> Result<String, String> {
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("code", auth_code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", "https://login.live.com/owlknie.srf"),
        ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
    ];
    let resp = client
        .post(MS_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Microsoft token error ({}): {}", resp.status(), body));
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

pub fn login_offline(username: &str) -> Result<Account, String> {
    if username.len() < 3 || username.len() > 16 {
        return Err("Username must be between 3 and 16 characters".to_string());
    }
    let offline_uuid = uuid::Uuid::new_v3(&uuid::Uuid::NAMESPACE_DNS, username);
    Ok(Account {
        name: username.to_string(),
        id: offline_uuid.as_simple().to_string(),
        account_type: "offline".to_string(),
        token: "0".to_string(),
    })
}
