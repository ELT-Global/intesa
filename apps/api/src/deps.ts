import type { AttemptLimiter } from "./auth/attempts"
import type { Config } from "./config"
import type { Db } from "./db"

// attempts is shared so sign-in and account-settings code checks draw on one budget per user.
export type Deps = { db: Db; config: Config; attempts: AttemptLimiter }
