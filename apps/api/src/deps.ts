import type { Config } from "./config"
import type { Db } from "./db"

export type Deps = { db: Db; config: Config }
