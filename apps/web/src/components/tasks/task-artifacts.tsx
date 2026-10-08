import { ARTIFACT_ACCEPT, artifactFileError } from "@intesa/api/artifacts"
import { MarkdownEditor } from "@intesa/markdown-editor"
import { useQuery } from "@tanstack/react-query"
import { FileText, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  type Artifact,
  artifactsQuery,
  artifactText,
  artifactUrl,
  useWriteArtifact,
} from "@/lib/artifacts"

export function TaskArtifacts({ taskId }: { taskId: string }) {
  const query = useQuery(artifactsQuery(taskId))
  const upload = useWriteArtifact(taskId)
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<Artifact | null>(null)

  async function add(files: File[]) {
    if (upload.isPending || !files.length) return
    setError(null)
    // Validate the whole selection first so an invalid batch doesn't partially upload.
    for (const file of files) {
      const invalid = artifactFileError(file)
      if (invalid) {
        setError(`${file.name}: ${invalid}`)
        return
      }
    }
    try {
      for (const file of files) await upload.mutateAsync({ file })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload artifact.")
    }
  }

  return (
    <section aria-label="Artifacts" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Artifacts</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-3.5" />
          {upload.isPending ? "Uploading…" : "Upload artifacts"}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ARTIFACT_ACCEPT}
        aria-label="Upload artifacts"
        className="hidden"
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      <fieldset
        aria-label="Drop artifacts"
        className={`rounded-lg border border-dashed p-3 ${dragging ? "border-ring bg-muted" : "border-border"}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void add(Array.from(e.dataTransfer.files))
        }}
      >
        <p className="text-xs text-muted-foreground">
          Drop files here · HTML, PDF, MD, DOC/DOCX, ODF · 5 MB per file
        </p>
        {query.isPending && (
          <p role="status" className="mt-2 text-xs">
            Loading artifacts…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="mt-2 text-xs">
            Could not load artifacts.{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        )}
        {!!query.data?.length && (
          <ul className="mt-2 flex flex-col gap-1">
            {query.data.map((artifact) => (
              <li key={artifact.id} className="flex items-center gap-2 text-[13px]">
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                {artifact.mimeType === "text/markdown" ? (
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => setEditing(artifact)}
                  >
                    {artifact.name}
                  </button>
                ) : (
                  <a
                    href={artifactUrl(taskId, artifact.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate hover:underline"
                  >
                    {artifact.name}
                  </a>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {Math.max(1, Math.ceil(artifact.size / 1024))} KB
                </span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <MarkdownArtifact
            key={editing.id}
            taskId={taskId}
            artifact={editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Dialog>
    </section>
  )
}

function MarkdownArtifact({
  taskId,
  artifact,
  onSaved,
}: {
  taskId: string
  artifact: Artifact
  onSaved: () => void
}) {
  const query = useQuery({
    queryKey: ["artifact-text", taskId, artifact.id, artifact.updatedAt],
    queryFn: () => artifactText(taskId, artifact.id),
    staleTime: 0,
  })
  const save = useWriteArtifact(taskId)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function commit() {
    const file = new File([draft ?? query.data ?? ""], artifact.name, { type: "text/markdown" })
    const invalid = artifactFileError(file)
    if (invalid) {
      setError(invalid)
      return
    }
    try {
      await save.mutateAsync({ file, id: artifact.id })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save artifact.")
    }
  }
  return (
    <DialogContent
      title={artifact.name}
      className="flex max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] flex-col gap-4"
    >
      {query.isPending && <p role="status">Loading Markdown…</p>}
      {query.isError && (
        <p role="alert">
          Could not load Markdown.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.data !== undefined && (
        <div className="min-h-0 overflow-auto">
          <MarkdownEditor
            label="Artifact Markdown"
            value={draft ?? query.data}
            onChange={setDraft}
            className="min-h-64 rounded-lg border border-border p-3"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onSaved} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void commit()}
          disabled={query.data === undefined || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save artifact"}
        </Button>
      </div>
    </DialogContent>
  )
}
