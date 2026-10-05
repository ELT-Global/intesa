import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Label, Select } from "@/components/ui/input"
import { api, keys, type MemberRole } from "@/lib/api"

export function AddMemberDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add member"
        description="They'll see this workspace the next time they sign in."
      >
        <AddForm workspaceId={workspaceId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AddForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const add = useMutation({
    mutationFn: () => api.addMember(workspaceId, { email: email.trim(), role }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.members(workspaceId) })
      onDone()
    },
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate()
      }}
    >
      <Field
        label="Email"
        error={add.error?.message}
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="member-role">Role</Label>
        <Select
          id="member-role"
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
        >
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" pending={add.isPending}>
          Add member
        </Button>
      </div>
    </form>
  )
}
