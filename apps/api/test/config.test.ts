import { describe, expect, test } from "bun:test"
import { configFromEnv, googleEnabled, optionalEnv } from "../src/config"

describe("configFromEnv", () => {
  test("empty or blank variables count as unset", () => {
    const config = configFromEnv({
      NODE_ENV: "",
      PORT: "",
      PUBLIC_URL: "  ",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: " ",
      DEV_LOGIN: "",
    })
    expect(config).toEqual({
      nodeEnv: "production",
      devLogin: false,
      googleClientId: undefined,
      googleClientSecret: undefined,
      publicUrl: "http://localhost:3000",
      secureCookies: false,
    })
    expect(googleEnabled(config)).toBe(false)
    expect(optionalEnv({ DATABASE_URL: "" }, "DATABASE_URL")).toBeUndefined()
  })

  test("the default public URL follows PORT, and trailing slashes are dropped", () => {
    expect(configFromEnv({ PORT: "8080" }).publicUrl).toBe("http://localhost:8080")
    expect(configFromEnv({ PUBLIC_URL: "https://pm.example.com//" }).publicUrl).toBe(
      "https://pm.example.com",
    )
  })

  test("secure cookies need production and an https public URL", () => {
    const prod = { NODE_ENV: "production" }
    expect(configFromEnv({ ...prod, PUBLIC_URL: "https://pm.example.com" }).secureCookies).toBe(
      true,
    )
    expect(configFromEnv({ ...prod, PUBLIC_URL: "http://pm.example.com" }).secureCookies).toBe(
      false,
    )
    expect(
      configFromEnv({ NODE_ENV: "development", PUBLIC_URL: "https://pm.example.com" })
        .secureCookies,
    ).toBe(false)
  })

  test("Google is enabled only when both the id and the secret are set", () => {
    expect(googleEnabled(configFromEnv({ GOOGLE_CLIENT_ID: "id" }))).toBe(false)
    expect(
      googleEnabled(configFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })),
    ).toBe(true)
  })
})
