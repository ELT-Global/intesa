export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024

const formats: Record<string, { mime: string; aliases?: string[] }> = {
  html: { mime: "text/html" },
  htm: { mime: "text/html" },
  pdf: { mime: "application/pdf" },
  md: { mime: "text/markdown", aliases: ["text/plain", "text/x-markdown"] },
  markdown: { mime: "text/markdown", aliases: ["text/plain", "text/x-markdown"] },
  doc: { mime: "application/msword" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  odt: { mime: "application/vnd.oasis.opendocument.text" },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet" },
  odp: { mime: "application/vnd.oasis.opendocument.presentation" },
  odg: { mime: "application/vnd.oasis.opendocument.graphics" },
}

export const ARTIFACT_ACCEPT = Object.keys(formats)
  .map((ext) => `.${ext}`)
  .join(",")

/** Browsers may omit MIME or report a generic binary type; the extension remains required. */
export function artifactFileError(file: { name: string; type: string; size: number }) {
  const format = artifactFormat(file.name)
  if (!format) return "Only HTML, PDF, Markdown, Word and OpenDocument files are allowed."
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe filename characters
  if (file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.name))
    return "Use a filename of at most 255 characters without paths or control characters."
  if (file.size > MAX_ARTIFACT_BYTES) return "Artifacts must be 5 MB or smaller."
  const mime = file.type.toLowerCase().split(";")[0]?.trim() ?? ""
  if (
    mime &&
    mime !== "application/octet-stream" &&
    mime !== format.mime &&
    !format.aliases?.includes(mime)
  )
    return "The file type does not match its extension."
  return null
}

export function artifactFormat(name: string) {
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  return Object.hasOwn(formats, extension) ? formats[extension] : undefined
}
