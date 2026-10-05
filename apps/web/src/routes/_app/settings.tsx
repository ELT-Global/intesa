import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, ShieldCheck, User as UserIcon } from "lucide-react"
import { useState } from "react"
import { renderSVG } from "uqr"
import { PageTitle } from "@/components/page"
import { Button } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { Label } from "@/components/ui/input"
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel"
import { api, keys, type User } from "@/lib/api"
import { meQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · Intesa" }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      qc.clear()
      await navigate({ to: "/login" })
    },
  })
  return (
    <div className="min-h-dvh">
      <header className="flex h-11 items-center gap-2 border-b border-border px-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          pending={logout.isPending}
          onClick={() => logout.mutate()}
        >
          Sign out
        </Button>
      </header>
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
        <PageTitle title="Account." description="Your profile and sign-in security." />
        <ProfilePanel />
        <TwoFactorPanel />
      </main>
    </div>
  )
}

function ProfilePanel() {
  const { data: user } = useSuspenseQuery(meQuery)
  const qc = useQueryClient()
  const [name, setName] = useState(user.name)
  const save = useMutation({
    mutationFn: () => api.updateMe({ name: name.trim() }),
    onSuccess: ({ user }) => qc.setQueryData(keys.me, user),
  })
  return (
    <Panel>
      <PanelHeader icon={<UserIcon />} title="Profile" />
      <PanelBody>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-muted-foreground">{user.email}</p>
          <FormError message={save.error?.message} />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              pending={save.isPending}
              disabled={!name.trim() || name.trim() === user.name}
            >
              Save
            </Button>
            {save.isSuccess && <span className="text-xs text-muted-foreground">Saved.</span>}
          </div>
        </form>
      </PanelBody>
    </Panel>
  )
}

function TwoFactorPanel() {
  const { data: user } = useSuspenseQuery(meQuery)
  return (
    <Panel>
      <PanelHeader icon={<ShieldCheck />} title="Two-factor authentication" />
      <PanelBody>{user.totpEnabled ? <DisableTwoFactor /> : <EnableTwoFactor />}</PanelBody>
    </Panel>
  )
}

function useUserMutation(fn: () => Promise<{ user: User }>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: ({ user }) => qc.setQueryData(keys.me, user) })
}

function EnableTwoFactor() {
  const [code, setCode] = useState("")
  const setup = useMutation({ mutationFn: api.setup2fa })
  const enable = useUserMutation(() => api.enable2fa(code))

  if (!setup.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Add a second step to sign-in with an authenticator app.
        </p>
        <FormError message={setup.error?.message} />
        <Button size="sm" pending={setup.isPending} onClick={() => setup.mutate()}>
          Set up two-factor
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        enable.mutate()
      }}
    >
      <p className="text-sm text-muted-foreground">
        Scan the code with your authenticator app, or enter the key by hand.
      </p>
      <div
        role="img"
        aria-label="Authenticator QR code"
        className="size-40 self-start rounded-lg bg-white p-2 [&>svg]:size-full"
        // Generated locally from the otpauth URL; contains no user-controlled markup.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: inline SVG from uqr
        dangerouslySetInnerHTML={{ __html: renderSVG(setup.data.otpauthUrl, { border: 0 }) }}
      />
      <Label htmlFor="secret-key" className="-mb-2">
        Secret key
      </Label>
      <output
        id="secret-key"
        className="block select-all break-all rounded-lg border border-border bg-muted px-2.5 py-2 font-mono text-[12.5px]"
      >
        {setup.data.secret}
      </output>
      <Field
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        inputClassName="font-mono"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <FormError message={enable.error?.message} />
      <Button
        type="submit"
        size="sm"
        variant="primary"
        className="self-start"
        pending={enable.isPending}
      >
        Enable two-factor
      </Button>
    </form>
  )
}

function DisableTwoFactor() {
  const [code, setCode] = useState("")
  const disable = useUserMutation(() => api.disable2fa(code))
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        disable.mutate()
      }}
    >
      <p className="text-sm">Two-factor authentication is on.</p>
      <p className="text-xs text-muted-foreground">Enter a current code to turn it off.</p>
      <Field
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        inputClassName="font-mono"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <FormError message={disable.error?.message} />
      <Button type="submit" size="sm" className="self-start" pending={disable.isPending}>
        Disable two-factor
      </Button>
    </form>
  )
}
