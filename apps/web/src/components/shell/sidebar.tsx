import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  Check,
  ChevronsUpDown,
  CircleCheck,
  House,
  LogOut,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  Sun,
  Users,
} from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, type Workspace } from "@/lib/api"
import { meQuery } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { ProjectsSection } from "./projects-section"

const navItem =
  "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4"

export function Wordmark() {
  return (
    <div className="flex h-11 items-center gap-2 px-2">
      <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
        I
      </span>
      <span className="text-sm font-medium">Intesa</span>
    </div>
  )
}

function WorkspaceSwitcher({
  workspace,
  workspaces,
  onNavigate,
}: {
  workspace: Workspace
  workspaces: Workspace[]
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const go = (to: "/new-workspace" | Workspace) => {
    onNavigate?.()
    if (typeof to === "string") void navigate({ to })
    else void navigate({ to: "/w/$slug/home", params: { slug: to.slug } })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch workspace"
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-background/40 p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Avatar name={workspace.name} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{workspace.name}</span>
          <span className="block text-[11px] text-subtle-foreground">
            {workspace.role === "owner" ? "Owner" : "Member"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => go(w)}>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === workspace.id && <Check />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go("/new-workspace")}>
          <Plus />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProfileCard({ onNavigate }: { onNavigate?: () => void }) {
  const { data: user } = useSuspenseQuery(meQuery)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { theme, setTheme } = useTheme()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      qc.clear()
      onNavigate?.()
      await navigate({ to: "/login" })
    },
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-background/40 p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Avatar name={user.name} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user.name}</span>
          <span className="block truncate text-[11px] text-subtle-foreground">{user.email}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-(--radix-dropdown-menu-trigger-width)"
      >
        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.()
            void navigate({ to: "/settings" })
          }}
        >
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            setTheme(theme === "dark" ? "light" : "dark")
          }}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SidebarContent({
  workspace,
  workspaces,
  onNavigate,
  onCollapse,
  header,
}: {
  workspace: Workspace
  workspaces: Workspace[]
  onNavigate?: () => void
  /** Desktop only: shows a collapse button in the header. */
  onCollapse?: () => void
  header?: React.ReactNode
}) {
  const params = { slug: workspace.slug }
  const items = [
    { to: "/w/$slug/home", label: "Home", icon: House },
    { to: "/w/$slug/my-tasks", label: "My tasks", icon: CircleCheck },
    { to: "/w/$slug/members", label: "Members", icon: Users },
  ] as const
  return (
    <div className="flex h-full flex-col gap-3 p-2">
      {header ?? (
        <div className="flex items-center justify-between">
          <Wordmark />
          {onCollapse && (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Collapse sidebar"
              title="Collapse sidebar ([)"
              onClick={onCollapse}
            >
              <PanelLeft />
            </Button>
          )}
        </div>
      )}
      <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} onNavigate={onNavigate} />
      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            params={params}
            onClick={onNavigate}
            className={navItem}
            activeProps={{ className: cn("bg-sidebar-accent text-sidebar-accent-foreground") }}
          >
            <Icon aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProjectsSection workspace={workspace} onNavigate={onNavigate} />
      </div>
      <ProfileCard onNavigate={onNavigate} />
    </div>
  )
}
