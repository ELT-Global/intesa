import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, KeyRound } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/members/confirm-dialog"
import { notify } from "@/components/mutation-error-notice"
import { errorMessage } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { Label, Select } from "@/components/ui/input"
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel"
import { type ApiToken, api, keys, type TokenScope } from "@/lib/api"
import { tokensQuery } from "@/lib/queries"
import { shortDate, timeAgo } from "@/lib/time"

const KIND_LABEL: Record<ApiToken["kind"], string> = { cli: "CLI session", pat: "Personal token" }
const SCOPE_LABEL: Record<TokenScope, string> = { read: "Read only", write: "Read and write" }

export function AccessTokensPanel() {
  const qc = useQueryClient()
  const tokens = useQuery(tokensQuery)
  // The plaintext of the token just created. Only ever held here, never refetched.
  const [created, setCreated] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const revoke = useMutation({
    mutationFn: (token: ApiToken) => api.revokeToken(token.id),
    onSuccess: (_, token) => {
      qc.setQueryData(keys.tokens, (old: ApiToken[] | undefined) =>
        old?.filter((t) => t.id !== token.id),
      )
      setRevoking(null)
    },
  })

  return (
    <Panel>
      <PanelHeader icon={<KeyRound />} title="Access tokens" count={tokens.data?.length} />
      <PanelBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Command-line sign-ins and personal tokens for scripts and agents. Revoke any you no longer
          use.
        </p>
        {tokens.isPending && <RowsSkeleton rows={2} />}
        {tokens.isError && (
          <div className="flex flex-col items-start gap-2">
            <FormError message={errorMessage(tokens.error)} />
            <Button size="sm" onClick={() => tokens.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {tokens.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No access tokens yet.</p>
        )}
        {!!tokens.data?.length && (
          <ul className="-my-1 divide-y divide-border/70">
            {tokens.data.map((token) => (
              <TokenRow key={token.id} token={token} onRevoke={() => setRevoking(token)} />
            ))}
          </ul>
        )}
        {created && <NewToken token={created} onDone={() => setCreated(null)} />}
        <CreateToken onCreated={setCreated} />
      </PanelBody>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null)
            revoke.reset()
          }
        }}
        title="Revoke token"
        description={`${revoking?.name ?? "This token"} stops working right away. Anything using it will need a new one.`}
        confirmLabel="Revoke"
        pending={revoke.isPending}
        error={revoke.error && errorMessage(revoke.error)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Panel>
  )
}

function TokenRow({ token, onRevoke }: { token: ApiToken; onRevoke: () => void }) {
  const expired = token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now()
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="break-words text-sm font-medium">{token.name}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{KIND_LABEL[token.kind]}</Chip>
          <Chip>{SCOPE_LABEL[token.scope]}</Chip>
          <Chip className="font-mono">…{token.lastFour}</Chip>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {shortDate(token.createdAt)}
          {" · "}
          {token.lastUsedAt ? `Last used ${timeAgo(token.lastUsedAt)}` : "Never used"}
          {" · "}
          {token.expiresAt === null ? (
            "No expiry"
          ) : expired ? (
            <span className="text-destructive-foreground">
              Expired {shortDate(token.expiresAt)}
            </span>
          ) : (
            `Expires ${shortDate(token.expiresAt)}`
          )}
        </p>
      </div>
      <Button size="sm" variant="ghost" aria-label={`Revoke ${token.name}`} onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  )
}

function NewToken({ token, onDone }: { token: string; onDone: () => void }) {
  const id = useId()
  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      notify("Copied token")
    } catch {
      notify("Could not copy to the clipboard.", "error")
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-medium">Copy your token now. It won't be shown again.</p>
      <Label htmlFor={id} className="sr-only">
        New token
      </Label>
      <output
        id={id}
        className="block select-all break-all rounded-lg border border-border bg-muted px-2.5 py-2 font-mono text-[12.5px]"
      >
        {token}
      </output>
      <div className="flex gap-2">
        <Button size="sm" onClick={copy}>
          <Copy />
          Copy token
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

function CreateToken({ onCreated }: { onCreated: (token: string) => void }) {
  const qc = useQueryClient()
  const scopeId = useId()
  const [name, setName] = useState("")
  const [scope, setScope] = useState<TokenScope>("write")
  const [days, setDays] = useState("")
  const create = useMutation({
    mutationFn: () =>
      api.createToken({
        name: name.trim(),
        scope,
        expiresInDays: days ? Number(days) : undefined,
      }),
    onSuccess: async ({ token }) => {
      onCreated(token)
      setName("")
      setDays("")
      await qc.invalidateQueries({ queryKey: keys.tokens })
    },
  })
  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <h3 className="text-sm font-medium">New personal token</h3>
      <Field
        label="Token name"
        error={create.error && errorMessage(create.error)}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={scopeId}>Scope</Label>
          <Select
            id={scopeId}
            value={scope}
            onChange={(e) => setScope(e.target.value as TokenScope)}
          >
            <option value="write">{SCOPE_LABEL.write}</option>
            <option value="read">{SCOPE_LABEL.read}</option>
          </Select>
        </div>
        <Field
          label="Expires in (days)"
          hint="Leave empty for no expiry."
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="primary"
        className="self-start"
        pending={create.isPending}
      >
        Create token
      </Button>
    </form>
  )
}
