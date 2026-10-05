// Writes .br and .gz copies next to the compressible files of a built web client, so the
// server can send them as-is instead of compressing on every request.
// Usage: bun precompress.ts <dir>
import { readdirSync, statSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"

const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".txt", ".xml", ".map"])
const MIN_BYTES = 1024

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

const dir = process.argv[2]
if (!dir) {
  console.error("usage: bun precompress.ts <dir>")
  process.exit(1)
}

let files = 0
let before = 0
let brotli = 0
let gzip = 0
for (const path of walk(dir)) {
  if (!COMPRESSIBLE.has(extname(path))) continue
  const input = Buffer.from(await Bun.file(path).arrayBuffer())
  if (input.length < MIN_BYTES) continue

  const br = brotliCompressSync(input, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  })
  const gz = gzipSync(input, { level: 9 })
  // A copy that is not smaller is not worth negotiating.
  if (br.length < input.length) writeFileSync(`${path}.br`, br)
  if (gz.length < input.length) writeFileSync(`${path}.gz`, gz)
  files++
  before += input.length
  brotli += Math.min(br.length, input.length)
  gzip += Math.min(gz.length, input.length)
}
console.log(`precompressed ${files} files: ${before} B -> br ${brotli} B, gzip ${gzip} B (${dir})`)
