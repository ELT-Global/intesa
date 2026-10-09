import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { CardPage, errorMessage } from "@/components/page"
import { Button, buttonClass } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { ApiError, api } from "@/lib/api"
import { meQuery } from "@/lib/queries"
import { timeAgo } from "@/lib/time"

export const Route = createFileRoute("/_app/device")({
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search.code === "string" ? { code: search.code } : {},
  head: () => ({ meta: [{ title: "Connect a device · Intesa" }] }),
  component: DevicePage,
})

function codeError(error: unknown): string {
  if (error instanceof ApiError && error.code === "NOT_FOUND") {
    return "That code wasn't found or has expired. Check your terminal and try again."
  }
  if (error instanceof ApiError && error.code === "RATE_LIMITED") {
    return "Too many attempts. Wait a few minutes, then try again."
  }
  return errorMessage(error)
}

function DevicePage() {
  const { code: initialCode = "" } = Route.useSearch()
  const { data: me } = useSuspenseQuery(meQuery)
  const [code, setCode] = useState(initialCode.toUpperCase())
  // The server accepts any case and with or without the dash, so the raw input is sent as is.
  const lookup = useMutation({ mutationFn: () => api.deviceRequest(code.trim()) })
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve ? api.approveDevice(code.trim()) : api.denyDevice(code.trim()),
  })

  function reset() {
    lookup.reset()
    decide.reset()
  }

  if (decide.isSuccess) {
    const approved = decide.variables
    return (
      <CardPage
        title={approved ? "Device approved." : "Request denied."}
        description={
          approved
            ? "You can return to your terminal now."
            : "Nothing was signed in. You can return to your terminal."
        }
      >
        <Link to="/" className={buttonClass("link", "xs")}>
          Back to Intesa
        </Link>
      </CardPage>
    )
  }

  if (lookup.data) {
    const { clientName, createdAt } = lookup.data
    return (
      <CardPage
        title={`Approve ${clientName}?`}
        description={`Requested ${timeAgo(createdAt)} with code ${code.trim().toUpperCase()}. Only approve if you just started this sign-in yourself.`}
      >
        <p className="text-sm text-muted-foreground">
          It will sign in as {me.email} and can read and change your data until you revoke it in
          Settings.
        </p>
        <FormError message={decide.error && codeError(decide.error)} />
        <div className="flex gap-2">
          <Button
            className="flex-1"
            pending={decide.isPending && decide.variables === false}
            disabled={decide.isPending}
            onClick={() => decide.mutate(false)}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            pending={decide.isPending && decide.variables === true}
            disabled={decide.isPending}
            onClick={() => decide.mutate(true)}
          >
            Approve
          </Button>
        </div>
        <Button variant="link" size="xs" onClick={reset}>
          Use a different code
        </Button>
      </CardPage>
    )
  }

  return (
    <CardPage
      title="Connect a device."
      description="Enter the code your terminal is showing to sign it in to your account."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          lookup.mutate()
        }}
      >
        <Field
          label="Device code"
          error={lookup.error && codeError(lookup.error)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          required
          autoFocus={!initialCode}
          inputClassName="font-mono uppercase tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button type="submit" variant="primary" pending={lookup.isPending}>
          Continue
        </Button>
      </form>
    </CardPage>
  )
}
