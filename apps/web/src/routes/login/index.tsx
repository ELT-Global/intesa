import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { CardPage } from "@/components/page"
import { Skeleton } from "@/components/skeleton"
import { Button, buttonClass } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { api } from "@/lib/api"
import { authConfigQuery } from "@/lib/queries"

export const Route = createFileRoute("/login/")({
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: LoginPage,
})

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was denied. Try again.",
  invalid_state: "That sign-in attempt expired. Try again.",
}

function LoginPage() {
  const { error } = Route.useSearch()
  const config = useQuery(authConfigQuery)
  return (
    <CardPage title="Sign in to Intesa." description="Tasks, projects and the people doing them.">
      <FormError
        message={error ? (ERROR_MESSAGES[error] ?? `Sign-in failed (${error}).`) : undefined}
      />
      {config.isPending && <Skeleton className="h-10" />}
      {config.isError && <FormError message="Couldn't reach the server. Reload to try again." />}
      {config.data?.google && (
        <a href="/api/auth/google/start" className={buttonClass("primary", "lg")}>
          Continue with Google
        </a>
      )}
      {config.data?.devLogin && <DevLoginForm primary={!config.data.google} />}
      {config.data && !config.data.google && !config.data.devLogin && (
        <p className="text-sm text-muted-foreground">No sign-in method is configured.</p>
      )}
    </CardPage>
  )
}

function DevLoginForm({ primary }: { primary: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const login = useMutation({
    mutationFn: () => api.devLogin({ email, name: name.trim() || undefined }),
    onSuccess: async (res) => {
      qc.clear()
      await navigate({ to: "twoFactorRequired" in res ? "/login/2fa" : "/" })
    },
  })

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        login.mutate()
      }}
    >
      <p className="text-xs text-muted-foreground">Development sign-in</p>
      <Field
        label="Email"
        error={login.error?.message}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Name (optional)"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" variant={primary ? "primary" : "outline"} pending={login.isPending}>
        Sign in
      </Button>
    </form>
  )
}
