import type { Config } from "../config"
import { randomToken } from "./session"

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

export const redirectUri = (config: Config) => `${config.publicUrl}/api/auth/google/callback`

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString("base64url")
}

export async function buildAuthUrl(config: Config) {
  const state = randomToken(16)
  const verifier = randomToken(32)
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: config.googleClientId ?? "",
    redirect_uri: redirectUri(config),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
  }).toString()
  return { url: url.toString(), state, verifier }
}

export type GoogleProfile = {
  sub: string
  email: string
  name?: string
  picture?: string
}

type IdClaims = {
  iss?: string
  aud?: string
  exp?: number
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

// The ID token comes straight from Google's token endpoint over TLS, so its claims are
// trusted without signature verification (the OIDC-permitted shortcut for the code flow).
export async function exchangeCode(
  config: Config,
  code: string,
  verifier: string,
): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId ?? "",
      client_secret: config.googleClientSecret ?? "",
      redirect_uri: redirectUri(config),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  const { id_token } = (await res.json()) as { id_token?: string }
  const payload = id_token?.split(".")[1]
  if (!payload) throw new Error("missing id_token")

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IdClaims
  if (!claims.iss || !ISSUERS.includes(claims.iss)) throw new Error("bad issuer")
  if (claims.aud !== config.googleClientId) throw new Error("bad audience")
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("expired id_token")
  if (!claims.sub || !claims.email || claims.email_verified !== true) {
    throw new Error("unverified email")
  }
  return { sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture }
}
