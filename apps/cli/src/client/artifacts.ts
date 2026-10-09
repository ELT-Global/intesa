import type { Http } from "./http"

export type Artifact = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
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
