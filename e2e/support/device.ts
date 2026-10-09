import { randomUUID } from "node:crypto"
import { expect, type Page } from "@playwright/test"

export type DeviceRequest = { deviceCode: string; userCode: string; clientName: string }

export type DevicePoll =
  | { status: "pending" | "slow_down" | "denied" | "expired" }
  | { status: "approved"; token: string; tokenId: string; user: { email: string } }

/** Starts a device sign-in the way a terminal would: no cookie, just the client name. */
export async function startDeviceRequest(
  page: Page,
  clientName = `intesa-cli on PC-${randomUUID().slice(0, 6)} (linux-x64)`,
): Promise<DeviceRequest> {
  const res = await page.request.post("/api/auth/device", { data: { clientName } })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { deviceCode: string; userCode: string }
  return { ...body, clientName }
}

export async function pollDeviceToken(page: Page, deviceCode: string): Promise<DevicePoll> {
  const res = await page.request.post("/api/auth/device/token", { data: { deviceCode } })
  expect(res.status()).toBe(200)
  return (await res.json()) as DevicePoll
}

/** Approves through the API as the page's signed-in user and returns the CLI token. */
export async function approveDeviceRequest(page: Page, request: DeviceRequest): Promise<string> {
  const approve = await page.request.post(`/api/auth/device/${request.userCode}/approve`)
  expect(approve.status()).toBe(204)
  const poll = await pollDeviceToken(page, request.deviceCode)
  if (poll.status !== "approved") throw new Error(`Expected approved, got ${poll.status}`)
  return poll.token
}
