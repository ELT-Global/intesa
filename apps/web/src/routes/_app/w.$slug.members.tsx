import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Ellipsis, Users } from "lucide-react"
import { useState } from "react"
import { AddMemberDialog } from "@/components/members/add-member-dialog"
import { ConfirmDialog } from "@/components/members/confirm-dialog"
import { PageTitle } from "@/components/page"
import { Avatar } from "@/components/ui/avatar"
import { Chip, CountBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Panel, PanelHeader } from "@/components/ui/panel"
import { api, keys, type Member } from "@/lib/api"
import { membersQuery, meQuery, workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug/members")({
  head: () => ({ meta: [{ title: "Members · Intesa" }] }),
  component: MembersPage,
})

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

function MembersPage() {
  const { slug } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const { data: me } = useSuspenseQuery(meQuery)
  const workspace = workspaces.find((w) => w.slug === slug)
  const workspaceId = workspace?.id ?? ""
  const { data: members } = useQuery({ ...membersQuery(workspaceId), enabled: !!workspace })

  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: keys.members(workspaceId) })
  const changeRole = useMutation({
    mutationFn: (m: Member) =>
      api.changeRole(workspaceId, m.id, m.role === "owner" ? "member" : "owner"),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (m: Member) => api.removeMember(workspaceId, m.id),
    onSuccess: async (_, m) => {
      if (m.userId === me.id) {
        await qc.invalidateQueries({ queryKey: keys.workspaces })
        await navigate({ to: "/" })
      } else {
        setRemoving(null)
        await refresh()
      }
    },
  })

  if (!workspace) return null
  const isOwner = workspace.role === "owner"
  const mine = members?.find((m) => m.userId === me.id)

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <PageTitle title="Members." description="The people in this workspace." />
        </div>
        <div className="flex items-center gap-2">
          {mine && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                remove.reset()
                setLeaving(true)
              }}
            >
              Leave workspace
            </Button>
          )}
          {isOwner && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add member
            </Button>
          )}
        </div>
      </div>

      <Panel>
        <PanelHeader
          icon={<Users />}
          title="Members"
          note={members ? <CountBadge>{members.length}</CountBadge> : undefined}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[12px] font-medium text-muted-foreground">
                <th className="h-9 border-b border-border px-4 font-medium">Name</th>
                <th className="h-9 border-b border-border px-4 font-medium">Role</th>
                <th className="h-9 border-b border-border px-4 font-medium">Joined</th>
                <th className="h-9 w-12 border-b border-border px-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-muted/40">
                  <td className="h-12 border-b border-border/70 px-4 last:border-0">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} size="lg" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-border/70 px-4">
                    {m.role === "owner" && <Chip>Owner</Chip>}
                  </td>
                  <td className="whitespace-nowrap border-b border-border/70 px-4 text-muted-foreground">
                    {joined(m.createdAt)}
                  </td>
                  <td className="border-b border-border/70 px-4 text-right">
                    {isOwner && m.userId !== me.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={`Actions for ${m.name}`}
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => changeRole.mutate(m)}>
                            {m.role === "owner" ? "Make member" : "Make owner"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive-foreground"
                            onSelect={() => {
                              remove.reset()
                              setRemoving(m)
                            }}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {changeRole.error && (
          <p
            role="alert"
            className="border-t border-border px-4 py-2.5 text-xs text-destructive-foreground"
          >
            {changeRole.error.message}
          </p>
        )}
      </Panel>

      {isOwner && (
        <AddMemberDialog workspaceId={workspaceId} open={adding} onOpenChange={setAdding} />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove member."
        description={`${removing?.name ?? "This member"} will lose access to ${workspace.name} and be unassigned from its tasks.`}
        confirmLabel="Confirm remove"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => removing && remove.mutate(removing)}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave workspace."
        description={`You'll lose access to ${workspace.name} and be unassigned from its tasks.`}
        confirmLabel="Confirm leave"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => mine && remove.mutate(mine)}
      />
    </>
  )
}
