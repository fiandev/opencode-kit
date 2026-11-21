import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

const FOLDERS = ["agents", "commands", "skills"] as const
const MAX_SYMLINK_HOPS = 40

const FRONTMATTER_OPEN = /^---\r?\n/
const FRONTMATTER_CLOSE = /^---\r?$/m
const MODEL_LINE = /^model:[^\r\n]*(\r?\n|$)/gm

export interface InstallOptions {
  srcRoot: string
  targetDir: string
  noAutoModel?: boolean
}

export interface InstallResult {
  action: "installed" | "updated"
  version: string
  strippedModels: number
}

type PackageJson = { version: string }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
}

/**
 * Remove `model:` lines from the first YAML frontmatter block of a Markdown file.
 *
 * Returns `null` when there is nothing to strip: no frontmatter, an unclosed
 * frontmatter block, or no top-level (column-0) `model:` line inside it.
 * Content outside the block is preserved byte-for-byte, and a second pass over
 * the result returns `null`.
 */
export function stripFrontmatterModel(content: string): string | null {
  const open = FRONTMATTER_OPEN.exec(content)
  if (!open) return null

  const bodyStart = open[0].length
  const rest = content.slice(bodyStart)
  const close = FRONTMATTER_CLOSE.exec(rest)
  if (!close) return null

  const body = rest.slice(0, close.index)
  const stripped = body.replace(MODEL_LINE, "")
  if (stripped === body) return null

  return content.slice(0, bodyStart) + stripped + rest.slice(close.index)
}

/**
 * Prepare a destination directory and return its real path.
 *
 * - symlink to a directory: follow it (keeping the link) and return the real path
 * - dangling symlink: remove the stale link and create a directory
 * - plain file: throw, never delete user data
 */
function prepareDestination(dest: string): string {
  const shown = dest
  let current = dest

  for (let hop = 0; hop <= MAX_SYMLINK_HOPS; hop++) {
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (!isMissing(error)) throw error
      mkdirSync(current, { recursive: true })
      return current
    }

    if (stat.isSymbolicLink()) {
      try {
        current = realpathSync(current)
      } catch (error) {
        if (!isMissing(error)) throw error
        rmSync(current, { force: true })
        mkdirSync(current, { recursive: true })
        return current
      }
      continue
    }

    if (stat.isDirectory()) return current

    throw new Error(`opencode-kit: ${shown} exists and is not a directory`)
  }

  throw new Error(`opencode-kit: ${shown} has too many levels of symbolic links`)
}

export function install({ srcRoot, targetDir, noAutoModel }: InstallOptions): InstallResult {
  const pluginSource = join(srcRoot, "dist")

  if (!existsSync(pluginSource)) {
    throw new Error('opencode-kit: dist/main.js not found. Run "bun run build" first.')
  }

  const isUpdate = [...FOLDERS, "plugins"].some((folder) => existsSync(join(targetDir, folder)))
  const pkg: PackageJson = JSON.parse(readFileSync(join(srcRoot, "package.json"), "utf-8"))

  let strippedModels = 0
  // Real path of the installed agents directory, hoisted out of the copy loop so
  // the model stripping below follows symlinks exactly like the copy did.
  let agentsDest: string | null = null

  for (const folder of FOLDERS) {
    const src = join(srcRoot, folder)
    if (!existsSync(src)) continue

    const dest = prepareDestination(join(targetDir, folder))
    cpSync(src, dest, { recursive: true })

    if (folder === "agents") agentsDest = dest
  }

  if (noAutoModel && agentsDest !== null) {
    for (const entry of readdirSync(agentsDest)) {
      if (!entry.endsWith(".md")) continue

      const file = join(agentsDest, entry)
      if (!lstatSync(file).isFile()) continue

      const stripped = stripFrontmatterModel(readFileSync(file, "utf-8"))
      if (stripped === null) continue

      writeFileSync(file, stripped)
      strippedModels++
    }
  }

  const pluginTarget = prepareDestination(join(targetDir, "plugins"))

  // Remove TypeScript sources installed by versions <= 1.2.0 so the plugin is not loaded twice
  if (existsSync(join(pluginTarget, "main.ts"))) {
    for (const file of ["main.ts", "plugin.ts", "hooks.ts", "types.ts", "constants.ts"]) {
      rmSync(join(pluginTarget, file), { force: true })
    }
    for (const dir of ["lib", "tools"]) {
      rmSync(join(pluginTarget, dir), { recursive: true, force: true })
    }
  }

  cpSync(pluginSource, pluginTarget, { recursive: true })

  return { action: isUpdate ? "updated" : "installed", version: pkg.version, strippedModels }
}
