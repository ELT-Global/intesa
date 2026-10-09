import pkg from "../package.json" with { type: "json" }

export const VERSION: string = pkg.version
export const USER_AGENT = `intesa-cli/${VERSION} (${process.platform}-${process.arch})`
