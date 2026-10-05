import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { useMatches } from "@tanstack/react-router"
import { Menu, X } from "lucide-react"
import { createContext, type ReactNode, useContext, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import type { Workspace } from "@/lib/api"
import { useRememberProjectView } from "@/lib/last-view"
import { projectQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { SidebarContent, Wordmark } from "./sidebar"

const TopBarSlot = createContext<HTMLElement | null>(null)

/** Renders children into the top bar's action area (view switcher, primary action). */
export function TopBarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlot)
  return slot ? createPortal(children, slot) : null
}

function TopBar({
  workspace,
  trigger,
  setSlot,
}: {
  workspace: Workspace
  trigger: ReactNode
  setSlot: (el: HTMLElement | null) => void
}) {
  useRememberProjectView()
  const matches = useMatches()
  const projectId = (
    matches.find((m) => m.routeId === "/_app/w/$slug/projects/$projectId")?.params as
      | { projectId?: string }
      | undefined
  )?.projectId
  const { data: project } = useQuery({ ...projectQuery(projectId ?? ""), enabled: !!projectId })
  const page = projectId
    ? (project?.name ?? "Project")
    : (matches.findLast((m) => m.staticData.title)?.staticData.title ?? "Home")
  return (
    <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md">
      {trigger}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden truncate text-muted-foreground sm:inline">{workspace.name}</span>
        <span className="hidden text-muted-foreground sm:inline" aria-hidden>
          /
        </span>
        <span className="truncate font-medium" aria-current="page">
          {page}
        </span>
      </nav>
      <div ref={setSlot} className="ml-2 flex min-w-0 flex-1 items-center gap-2" />
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
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // The kanban board needs the full main area and its own scrolling.
  const fullBleed = useMatches({ select: (ms) => ms.some((m) => m.staticData.fullBleed) })
  return (
    <div className="flex h-dvh overflow-hidden">
      <button
        type="button"
        onClick={() => {
          document.getElementById("main")?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-popover focus:px-3 focus:py-1.5 focus:text-[13px] focus:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to content
      </button>
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:block lg:max-xl:w-60">
        <SidebarContent workspace={workspace} workspaces={workspaces} />
      </aside>

      <TopBarSlot.Provider value={slot}>
        <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              workspace={workspace}
              setSlot={setSlot}
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
            <main
              id="main"
              tabIndex={-1}
              className={cn(
                "min-h-0 flex-1 px-4 py-6 outline-none sm:px-8",
                fullBleed ? "flex flex-col overflow-hidden" : "overflow-y-auto",
              )}
            >
              <div
                className={cn(
                  fullBleed ? "flex min-h-0 w-full flex-1 flex-col" : "mx-auto max-w-4xl",
                )}
              >
                {children}
              </div>
            </main>
          </div>

          <Dialog.Portal>
            <Dialog.Overlay className="drawer-scrim fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              className="drawer-panel fixed inset-y-0 left-0 z-50 w-[min(288px,85vw)] overflow-y-auto border-r border-sidebar-border bg-sidebar shadow-2xl ring-1 ring-black/5 outline-none md:hidden"
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
      </TopBarSlot.Provider>
    </div>
  )
}
