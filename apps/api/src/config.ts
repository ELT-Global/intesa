export type Config = {
  nodeEnv: string
  devLogin: boolean
  googleClientId?: string
  googleClientSecret?: string
  // Public origin of the app, without a trailing slash; used for OAuth redirect URIs.
  publicUrl: string
  secureCookies: boolean
}

type Env = Record<string, string | undefined>

// Compose files and hosting panels pass unset variables through as empty strings, so empty
// (or blank) means unset everywhere.
export const optionalEnv = (env: Env, name: string) => env[name]?.trim() || undefined

export function configFromEnv(env: Env): Config {
  // An unset NODE_ENV is treated as production so dev-only features fail closed.
  const nodeEnv = optionalEnv(env, "NODE_ENV") ?? "production"
  const port = optionalEnv(env, "PORT") ?? "3000"
  const publicUrl = (optionalEnv(env, "PUBLIC_URL") ?? `http://localhost:${port}`).replace(
    /\/+$/,
    "",
  )
  return {
    nodeEnv,
    devLogin: nodeEnv !== "production" && optionalEnv(env, "DEV_LOGIN") === "true",
    googleClientId: optionalEnv(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: optionalEnv(env, "GOOGLE_CLIENT_SECRET"),
    publicUrl,
    secureCookies: nodeEnv === "production" && publicUrl.startsWith("https://"),
  }
}

export const googleEnabled = (c: Config) => Boolean(c.googleClientId && c.googleClientSecret)
