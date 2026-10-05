import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { CardPage } from "@/components/page"
import { Button, buttonClass } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { api } from "@/lib/api"

export const Route = createFileRoute("/login/2fa")({ component: TwoFactorPage })

function TwoFactorPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [code, setCode] = useState("")
  const verify = useMutation({
    mutationFn: () => api.verify2fa(code),
    onSuccess: async () => {
      qc.clear()
      await navigate({ to: "/" })
    },
  })

  return (
    <CardPage
      title="Check your authenticator."
      description="Enter the 6-digit code from your authenticator app."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          verify.mutate()
        }}
      >
        <Field
          label="Authentication code"
          error={verify.error?.message}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          required
          autoFocus
          inputClassName="font-mono"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <Button type="submit" variant="primary" pending={verify.isPending}>
          Verify
        </Button>
      </form>
      <Link to="/login" className={buttonClass("link", "xs")}>
        Back to sign in
      </Link>
    </CardPage>
  )
}
