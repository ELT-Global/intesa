import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Ellipsis, Users } from "lucide-react"
import { useRef, useState } from "react"
import { AddMemberDialog } from "@/components/members/add-member-dialog"
import { ConfirmDialog } from "@/components/members/confirm-dialog"
import { ErrorState, PageTitle } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { Avatar } from "@/components/ui/avatar"
import { Chip } from "@/components/ui/badge"
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
import { clearLastWorkspace } from "@/lib/last-workspace"
import { membersQuery, meQuery, workspacesQuery } from "@/lib/queries"
import { invalidateTaskGraph } from "@/lib/tasks"

export const Route = createFileRoute("/_app/w/$slug/members")({
  staticData: { title: "Members" },
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
  const membersResult = useQuery({ ...membersQuery(workspaceId), enabled: !!workspace })
  const members = membersResult.data

  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const rowTriggers = useRef(new Map<string, HTMLElement>())
  const removeFocusRef = useRef<HTMLElement | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: keys.members(workspaceId) })
  // Assignees appear in task lists, home and my tasks; membership changes can unassign people.
  const refreshAssignees = () => invalidateTaskGraph(qc)
  const changeRole = useMutation({
    mutationFn: (m: Member) =>
      api.changeRole(workspaceId, m.id, m.role === "owner" ? "member" : "owner"),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (m: Member) => api.removeMember(workspaceId, m.id),
    onSuccess: async () => {
      setRemoving(null)
      await refreshAssignees()
    },
  })
  const leave = useMutation({
    mutationFn: (m: Member) => api.removeMember(workspaceId, m.id),
    onSuccess: async () => {
      clearLastWorkspace(slug)
      qc.removeQueries({ queryKey: ["workspaces", workspaceId] })
      qc.removeQueries({ queryKey: ["projects"] })
      qc.removeQueries({ queryKey: ["tasks"] })
      await qc.invalidateQueries({ queryKey: keys.workspaces })
      await navigate({ to: "/" })
    },
  })

  if (!workspace) return null
  const isOwner = workspace.role === "owner"
  const mine = members?.find((m) => m.userId === me.id)

  return (
    <>
      <PageTitle
        title="Members."
        description="The people in this workspace."
        actions={
          <>
            {mine && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  leave.reset()
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
          </>
        }
      />

      <Panel>
        <PanelHeader icon={<Users />} title="Members" count={members?.length} />
        {membersResult.isError && (
          <ErrorState error={membersResult.error} onRetry={() => void membersResult.refetch()} />
        )}
        {!members && !membersResult.isError && (
          <div className="p-4">
            <RowsSkeleton rows={3} />
          </div>
        )}
        <div className="relative overflow-x-auto" hidden={!members}>
          <table aria-label="Workspace members" className="w-full border-collapse text-[13px]">
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
                <tr
                  key={m.id}
                  className="transition-colors hover:bg-muted/40 [&:not(:last-child)>td]:border-b [&>td]:border-border/70"
                >
                  <td className="h-10 px-4">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} />
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                    </div>
                  </td>
                  <td className="px-4">
                    {m.role === "owner" ? (
                      <Chip>Owner</Chip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 text-muted-foreground">
                    {joined(m.createdAt)}
                  </td>
                  <td className="px-4 text-right">
                    {isOwner && m.userId !== me.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            ref={(el) => {
                              if (el) rowTriggers.current.set(m.id, el)
                              else rowTriggers.current.delete(m.id)
                            }}
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={`Actions for ${m.name}`}
                            disabled={changeRole.isPending}
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
                              removeFocusRef.current = rowTriggers.current.get(m.id) ?? null
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
        returnFocusRef={removeFocusRef}
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove member"
        description={`${removing?.name ?? "This member"} will lose access to ${workspace.name} and be unassigned from its tasks.`}
        confirmLabel="Remove"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => removing && remove.mutate(removing)}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave workspace"
        description={`You'll lose access to ${workspace.name} and be unassigned from its tasks.`}
        confirmLabel="Leave"
        pending={leave.isPending}
        error={leave.error?.message}
        onConfirm={() => mine && leave.mutate(mine)}
      />
    </>
  )
}
