import { z } from "zod"
import { completeWords } from "../registry/completion"
import { defineCommand } from "../registry/define"

// Called by the completion scripts on every tab press, never by people. It must be quiet
// and never fail: a broken lookup is just no suggestions.
export default defineCommand({
  name: "__complete",
  summary: "Print completion candidates for the words typed so far",
  args: [{ name: "words", variadic: true, description: "The words before the one being typed" }],
  flags: z.object({
    word: z.string().default("").meta({ placeholder: "text", description: "The word being typed" }),
  }),
  examples: ["intesa __complete --word=tok --", "intesa __complete --word= -- token"],
  async run(ctx, { words }, { word }) {
    try {
      const found = await completeWords(ctx, words, word)
      ctx.stdout(found.map((c) => `${c}\n`).join(""))
    } catch {}
  },
})
