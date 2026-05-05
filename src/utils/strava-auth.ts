import fs from 'fs';
import path from 'path';
import "dotenv/config";

const TOKENS_FILE = path.resolve(process.cwd(), 'strava_tokens.json');
const STRAVA_TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";

interface StravaTokens {
    access_token: string;
    refresh_token: string;
    expires_at: number; // unix timestamp
}

function loadTokens(): StravaTokens | null {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
        }
    } catch {
        // arquivo corrompido, ignora
    }
    return null;
}

function saveTokens(tokens: StravaTokens) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

function isExpired(tokens: StravaTokens): boolean {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return nowInSeconds >= tokens.expires_at - 300; // renova 5min antes de expirar
}

async function exchangeCodeForTokens(code: string): Promise<StravaTokens> {
    console.error("🔑 [Strava Auth] Trocando authorization_code por tokens...");

    const response = await fetch(STRAVA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code,
            grant_type: "authorization_code"
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Falha na troca do código: ${response.status} - ${error}`);
    }

    const data = await response.json();

    const tokens: StravaTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at
    };

    saveTokens(tokens);
    console.error("✅ [Strava Auth] Tokens obtidos e salvos com sucesso!");
    return tokens;
}

async function refreshAccessToken(refreshToken: string): Promise<StravaTokens> {
    console.error("🔄 [Strava Auth] Access token expirado. Renovando...");

    const response = await fetch(STRAVA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token"
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Falha ao renovar token: ${response.status} - ${error}`);
    }

    const data = await response.json();

    const tokens: StravaTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at
    };

    saveTokens(tokens);
    console.error("✅ [Strava Auth] Token renovado com sucesso!");
    return tokens;
}

export async function getValidAccessToken(): Promise<string> {
    let tokens = loadTokens();

    // 1. Tokens no arquivo e ainda válidos
    if (tokens && !isExpired(tokens)) {
        return tokens.access_token;
    }

    // 2. Tokens no arquivo mas expirados — faz o refresh
    if (tokens && isExpired(tokens)) {
        tokens = await refreshAccessToken(tokens.refresh_token);
        return tokens.access_token;
    }

    // 3. Sem arquivo — tenta trocar o authorization_code do .env (uso único)
    const code = process.env.STRAVA_AUTH_CODE;
    if (code) {
        try {
            tokens = await exchangeCodeForTokens(code);
            return tokens.access_token;
        } catch (err: any) {
            console.error(`⚠️ [Strava Auth] Falha ao trocar o authorization_code: ${err.message}`);
            console.error("⚠️ [Strava Auth] O code pode ter expirado. Tentando fallback com STRAVA_ACCESS_TOKEN...");
        }
    }

    // 4. Fallback: usa o STRAVA_ACCESS_TOKEN do .env diretamente
    const envToken = process.env.STRAVA_ACCESS_TOKEN;
    if (envToken) {
        console.error("⚠️ [Strava Auth] Usando STRAVA_ACCESS_TOKEN do .env (sem refresh automático).");
        return envToken;
    }

    throw new Error(
        "Nenhum token Strava disponível. Refaça o fluxo OAuth para obter um novo authorization_code."
    );
}
