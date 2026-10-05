import { zValidator } from "@hono/zod-validator"
import type { ValidationTargets } from "hono"
import type { ZodType } from "zod"
import { ApiError } from "./errors"

// Every route validates through this so failures share the {code, message} error shape.
export const validate = <T extends keyof ValidationTargets, S extends ZodType>(
  target: T,
  schema: S,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0]
      const path = issue?.path.join(".")
      throw new ApiError(
        "VALIDATION_ERROR",
        issue ? (path ? `${path}: ${issue.message}` : issue.message) : "Invalid request",
      )
    }
  })
