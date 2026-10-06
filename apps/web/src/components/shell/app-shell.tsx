import { useQuery } from "@tanstack/react-query"
import { useMatches } from "@tanstack/react-router"
import { Menu, PanelLeft, X } from "lucide-react"
import { createContext, type ReactNode, useContext, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import type { Workspace } from "@/lib/api"
import { useRememberProjectView } from "@/lib/last-view"
import { projectQuery } from "@/lib/queries"
import { useSidebarCollapsed } from "@/lib/sidebar"
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
  sidebarToggle,
  setSlot,
}: {
  workspace: Workspace
  trigger: ReactNode
  sidebarToggle: ReactNode
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
      {sidebarToggle}
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
  const { collapsed, toggle } = useSidebarCollapsed()
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
      <aside
        inert={collapsed}
        className={cn(
          "hidden shrink-0 overflow-hidden bg-sidebar transition-[width,visibility] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none md:block",
          collapsed ? "invisible w-0" : "w-64 border-r border-sidebar-border lg:max-xl:w-60",
        )}
      >
        <div className="h-full w-64 overflow-y-auto lg:max-xl:w-60">
          <SidebarContent workspace={workspace} workspaces={workspaces} onCollapse={toggle} />
        </div>
      </aside>

      <TopBarSlot.Provider value={slot}>
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              workspace={workspace}
              setSlot={setSlot}
              sidebarToggle={
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  className="max-md:hidden"
                  aria-label="Toggle sidebar"
                  aria-expanded={!collapsed}
                  title="Toggle sidebar ([)"
                  onClick={toggle}
                >
                  <PanelLeft />
                </Button>
              }
              trigger={
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    className="md:hidden"
                    aria-label="Open navigation"
                  >
                    <Menu />
                  </Button>
                </SheetTrigger>
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

          <SheetContent
            side="left"
            overlayClassName="md:hidden"
            aria-describedby={undefined}
            className="w-[min(288px,85vw)] overflow-y-auto border-r border-sidebar-border bg-sidebar shadow-2xl ring-1 ring-black/5 md:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              workspace={workspace}
              workspaces={workspaces}
              onNavigate={() => setDrawerOpen(false)}
              header={
                <div className="flex items-center justify-between">
                  <Wordmark />
                  <SheetClose asChild>
                    <Button variant="ghost" size="sm" icon aria-label="Close navigation">
                      <X />
                    </Button>
                  </SheetClose>
                </div>
              }
            />
          </SheetContent>
        </Sheet>
      </TopBarSlot.Provider>
    </div>
  )
}
