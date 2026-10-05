export type Config = {
  nodeEnv: string
  devLogin: boolean
  googleClientId?: string
  googleClientSecret?: string
  // Public origin of the app, without a trailing slash; used for OAuth redirect URIs.
  publicUrl: string
  secureCookies: boolean
}

export function configFromEnv(env: Record<string, string | undefined>): Config {
  // An unset NODE_ENV is treated as production so dev-only features fail closed.
  const nodeEnv = env.NODE_ENV ?? "production"
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, "")
  return {
    nodeEnv,
    devLogin: nodeEnv !== "production" && env.DEV_LOGIN === "true",
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    publicUrl,
    secureCookies: nodeEnv === "production" && publicUrl.startsWith("https://"),
  }
}

export const googleEnabled = (c: Config) => Boolean(c.googleClientId && c.googleClientSecret)
