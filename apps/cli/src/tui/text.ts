// Styled lines for OpenTUI text: segments with a style, fitted to a width by us (OpenTUI's own
// truncation cuts in the middle), and a small reader for the ANSI that Bun's Markdown emits.
import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core"

export type Seg = {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strike?: boolean
}
export type Line = Seg[]

export const width = (text: string) => Bun.stringWidth(text)
export const lineWidth = (line: Line) => line.reduce((n, s) => n + width(s.text), 0)

// Cuts a string to `max` columns, ending in "…" when something was cut.
export function truncate(text: string, max: number): string {
  if (max <= 0) return ""
  if (width(text) <= max) return text
  let out = ""
  for (const ch of text) {
    if (width(out + ch) > max - 1) break
    out += ch
  }
  return `${out}…`
}

/** The line cut to exactly `cols` columns, padded with `fill` (so a background reaches the edge). */
export function fit(line: Line, cols: number, fill: Omit<Seg, "text"> = {}): Line {
  const out: Line = []
  let used = 0
  for (const seg of line) {
    const room = cols - used
    if (room <= 0) break
    const text = truncate(seg.text, room)
    out.push({ ...seg, text })
    used += width(text)
    if (text !== seg.text) break
  }
  if (used < cols) out.push({ ...fill, text: " ".repeat(cols - used) })
  return out
}

// Word-wraps plain text to `cols`, keeping explicit line breaks.
export function wrap(text: string, cols: number): string[] {
  const out: string[] = []
  for (const para of text.split("\n")) {
    let line = ""
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue
      if (width(line + word) <= cols) {
        line += word
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      line = word.trimStart()
      while (width(line) > cols) {
        const head = truncate(line, cols + 1).slice(0, -1)
        out.push(head)
        line = line.slice(head.length)
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

const rgba = (hex: string | undefined) => (hex ? RGBA.fromHex(hex) : undefined)

/** Lines as one StyledText. Without color only attributes survive. */
export function styled(lines: Line[], color: boolean): StyledText {
  const chunks: TextChunk[] = []
  lines.forEach((line, i) => {
    if (i > 0) chunks.push({ __isChunk: true, text: "\n" })
    for (const seg of line) {
      if (!seg.text) continue
      let attributes = 0
      if (seg.bold) attributes |= TextAttributes.BOLD
      if (seg.dim) attributes |= TextAttributes.DIM
      if (seg.italic) attributes |= TextAttributes.ITALIC
      if (seg.underline) attributes |= TextAttributes.UNDERLINE
      if (seg.inverse) attributes |= TextAttributes.INVERSE
      if (seg.strike) attributes |= TextAttributes.STRIKETHROUGH
      chunks.push({
        __isChunk: true,
        text: seg.text,
        fg: color ? rgba(seg.fg) : undefined,
        bg: color ? rgba(seg.bg) : undefined,
        attributes,
      })
    }
  })
  return new StyledText(chunks)
}

const BASIC = [
  "#000000",
  "#cd3131",
  "#0dbc79",
  "#e5e510",
  "#2472c8",
  "#bc3fbc",
  "#11a8cd",
  "#e5e5e5",
]
const BRIGHT = [
  "#666666",
  "#f14c4c",
  "#23d18b",
  "#f5f543",
  "#3b8eea",
  "#d670d6",
  "#29b8db",
  "#ffffff",
]
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`

function color256(n: number): string {
  if (n < 8) return BASIC[n] ?? "#ffffff"
  if (n < 16) return BRIGHT[n - 8] ?? "#ffffff"
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return hex(v, v, v)
  }
  const i = n - 16
  const step = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return hex(step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6))
}

/** ANSI text (SGR colors and attributes) as styled lines; other escapes are dropped. */
export function fromAnsi(text: string): Line[] {
  // OSC sequences (hyperlinks) carry no visible text.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequences start with ESC
  const clean = text.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
  const lines: Line[] = [[]]
  let style: Omit<Seg, "text"> = {}
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR sequences start with ESC
  const re = /\x1b\[([\d;]*)m|\n|[^\x1b\n]+|\x1b/g
  for (const m of clean.matchAll(re)) {
    const [token, params] = m
    if (token === "\n") {
      lines.push([])
      continue
    }
    if (params === undefined) {
      if (token !== "\x1b") lines.at(-1)?.push({ ...style, text: token })
      continue
    }
    const codes = params === "" ? [0] : params.split(";").map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i] ?? 0
      if (c === 0) style = {}
      else if (c === 1) style = { ...style, bold: true }
      else if (c === 2) style = { ...style, dim: true }
      else if (c === 3) style = { ...style, italic: true }
      else if (c === 4) style = { ...style, underline: true }
      else if (c === 9) style = { ...style, strike: true }
      else if (c === 22) style = { ...style, bold: false, dim: false }
      else if (c === 23) style = { ...style, italic: false }
      else if (c === 24) style = { ...style, underline: false }
      else if (c === 29) style = { ...style, strike: false }
      else if (c === 39) style = { ...style, fg: undefined }
      else if (c === 49) style = { ...style, bg: undefined }
      else if (c >= 30 && c <= 37) style = { ...style, fg: BASIC[c - 30] }
      else if (c >= 90 && c <= 97) style = { ...style, fg: BRIGHT[c - 90] }
      else if (c >= 40 && c <= 47) style = { ...style, bg: BASIC[c - 40] }
      else if (c >= 100 && c <= 107) style = { ...style, bg: BRIGHT[c - 100] }
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "fg" : "bg"
        if (codes[i + 1] === 5) {
          style = { ...style, [key]: color256(codes[i + 2] ?? 0) }
          i += 2
        } else if (codes[i + 1] === 2) {
          style = { ...style, [key]: hex(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0) }
          i += 4
        }
      }
    }
  }
  return lines
}
