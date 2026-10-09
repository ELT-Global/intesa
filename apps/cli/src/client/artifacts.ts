import { statSync } from "node:fs"
import { basename } from "node:path"
import { artifactFileError } from "@intesa/api/artifacts"
import { invalid, usageError } from "../output/errors"
import type { Http } from "./http"

export type Artifact = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
}

// A file on this machine, checked for upload.
export type LocalFile = { path: string; name: string }

// Everything the server would reject without reading the content: a missing file is a usage
// error, an unsupported or oversized one a validation error, as on the server. Errors name the
// file as `typed`, which defaults to `path`.
export function checkFile(path: string, typed = path): LocalFile {
  const name = basename(path)
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch {
    throw usageError(`${typed}: no such file`)
  }
  if (!stat.isFile()) throw usageError(`${typed}: not a file`)
  const problem = artifactFileError({ name, type: "", size: stat.size })
  if (problem) throw invalid(`${name}: ${problem}`)
  return { path, name }
}

// The multipart upload the web sends: POST to the task's artifacts to add a file, PUT to an
// artifact's own URL to replace its content. No content type is set on the file: the server
// derives it from the extension and checks the bytes.
export async function sendArtifact(
  http: Http,
  method: "POST" | "PUT",
  url: string,
  name: string,
  content: string | Uint8Array,
): Promise<Artifact> {
  const body = new FormData()
  body.set("file", new File([content], name))
  const res = await http.request(url, { method, body })
  return ((await res.json()) as { artifact: Artifact }).artifact
}
