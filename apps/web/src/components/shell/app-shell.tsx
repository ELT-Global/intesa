import * as Dialog from "@radix-ui/react-dialog"
import { useLocation } from "@tanstack/react-router"
import { Menu, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import type { Workspace } from "@/lib/api"
import { SidebarContent, Wordmark } from "./sidebar"

const PAGE_TITLES: Record<string, string> = {
  home: "Home",
  "my-tasks": "My Tasks",
  members: "Members",
}

function TopBar({ workspace, trigger }: { workspace: Workspace; trigger: ReactNode }) {
  const segment = useLocation({ select: (l) => l.pathname.split("/")[3] ?? "" })
  const page = PAGE_TITLES[segment] ?? "Home"
  return (
    <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md">
      {trigger}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden truncate text-muted-foreground sm:inline">{workspace.name}</span>
        <span className="hidden text-muted-foreground sm:inline" aria-hidden>
          /
        </span>
        <span className="font-medium" aria-current="page">
          {page}
        </span>
      </nav>
    </header>
  )
}

export function AppShell({
  workspace,
  workspaces,
  children,
}: {
  workspace: Workspace
  workspaces: Workspace[]
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:block lg:max-xl:w-60">
        <SidebarContent workspace={workspace} workspaces={workspaces} />
      </aside>

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            workspace={workspace}
            trigger={
              <Dialog.Trigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  className="md:hidden"
                  aria-label="Open navigation"
                >
                  <Menu />
                </Button>
              </Dialog.Trigger>
            }
          />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto max-w-4xl">{children}</div>
          </main>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="drawer-scrim fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="drawer-panel fixed inset-y-0 left-0 z-50 w-[min(288px,85vw)] overflow-y-auto border-r border-sidebar-border bg-sidebar shadow-2xl outline-none md:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarContent
              workspace={workspace}
              workspaces={workspaces}
              onNavigate={() => setDrawerOpen(false)}
              header={
                <div className="flex items-center justify-between">
                  <Wordmark />
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm" icon aria-label="Close navigation">
                      <X />
                    </Button>
                  </Dialog.Close>
                </div>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
