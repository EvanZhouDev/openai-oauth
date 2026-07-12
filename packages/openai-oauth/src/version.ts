import packageMetadata from "../package.json" with { type: "json" }

export const packageVersion = packageMetadata.version
