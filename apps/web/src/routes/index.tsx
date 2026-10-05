import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "@/lib/api"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await api.api.health.$get()
      if (!res.ok) throw new Error(`health ${res.status}`)
      return res.json()
    },
  })

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Intesa</h1>
      <p className="mt-2 text-muted-foreground" data-testid="health">
        {health.isPending ? "Checking API…" : health.isError ? "API error" : "API OK"}
      </p>
    </main>
  )
}
