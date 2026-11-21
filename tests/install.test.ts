import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { install, stripFrontmatterModel } from "../installer/install"

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    rmSync(cleanups.pop()!, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

/** Realistic LF agent file with a column-0 `model:` in the frontmatter. */
const ORCHESTRATOR_SRC =
  "---\ndescription: x\nmode: primary\nmodel: opencode-go/deepseek-v4.1-flash\ntemperature: 0.3\n---\n# orchestrator\n"

/** Realistic CRLF agent file with a column-0 `model:` in the middle of the block. */
const EXTRA_SRC =
  "---\r\ndescription: extra\r\nmodel: opencode-go/another-model\r\nmode: subagent\r\n---\r\n# extra\r\n"

/** Build a fake package root so tests never need a real dist/main.js in the repo. */
function makePackageRoot(version = "9.9.9"): string {
  const root = tempDir("opencode-kit-install-src-")

  mkdirSync(join(root, "agents"), { recursive: true })
  writeFileSync(join(root, "agents", "orchestrator.md"), ORCHESTRATOR_SRC)
  writeFileSync(join(root, "agents", "extra.md"), EXTRA_SRC)

  mkdirSync(join(root, "commands"), { recursive: true })
  writeFileSync(join(root, "commands", "commit.md"), "# commit\n")

  mkdirSync(join(root, "skills", "workflow"), { recursive: true })
  writeFileSync(join(root, "skills", "workflow", "SKILL.md"), "# workflow\n")

  mkdirSync(join(root, "dist"), { recursive: true })
  writeFileSync(join(root, "dist", "main.js"), "export default {}\n")

  writeFileSync(join(root, "package.json"), JSON.stringify({ version }))
  return root
}

describe("install", () => {
  test("follows a symlinked destination and keeps the link intact", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const realSkills = tempDir("opencode-kit-install-real-skills-")

    symlinkSync(realSkills, join(targetDir, "skills"), "dir")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "updated")
    assert.equal(result.version, "9.9.9")
    assert.ok(lstatSync(join(targetDir, "skills")).isSymbolicLink())
    assert.equal(realpathSync(join(targetDir, "skills")), realpathSync(realSkills))
    assert.ok(existsSync(join(realSkills, "workflow", "SKILL.md")))
    assert.ok(existsSync(join(targetDir, "agents", "orchestrator.md")))
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
    assert.ok(existsSync(join(targetDir, "plugins", "main.js")))
  })

  test("refuses to overwrite a plain file destination without losing data", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const plainFile = join(targetDir, "agents")

    writeFileSync(plainFile, "keep me")

    assert.throws(
      () => install({ srcRoot, targetDir }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /agents exists and is not a directory/)
        assert.doesNotMatch(error.message, /ERR_FS_CP_DIR_TO_NON_DIR/)
        return true
      },
    )

    assert.equal(readFileSync(plainFile, "utf-8"), "keep me")
  })

  test("installs into an empty target", () => {
    const srcRoot = makePackageRoot()
    const targetDir = join(tempDir("opencode-kit-install-parent-"), ".opencode")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "installed")
    assert.equal(result.version, "9.9.9")
    assert.ok(existsSync(join(targetDir, "agents", "orchestrator.md")))
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
    assert.ok(existsSync(join(targetDir, "skills", "workflow", "SKILL.md")))
    assert.ok(existsSync(join(targetDir, "plugins", "main.js")))
    assert.ok(!existsSync(join(targetDir, "plugins", "main.ts")))
  })

  test("replaces a dangling symlink with a real directory", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const missing = join(tempDir("opencode-kit-install-missing-"), "gone")

    symlinkSync(missing, join(targetDir, "commands"), "dir")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "installed")
    assert.ok(!lstatSync(join(targetDir, "commands")).isSymbolicLink())
    assert.ok(lstatSync(join(targetDir, "commands")).isDirectory())
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
  })
})

describe("install noAutoModel", () => {
  test("strips model lines, keeps the rest of the frontmatter in order", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")

    const result = install({ srcRoot, targetDir, noAutoModel: true })

    assert.equal(result.action, "installed")
    assert.equal(result.strippedModels, 2)

    const installed = readFileSync(join(targetDir, "agents", "orchestrator.md"), "utf-8")

    // No column-0 `model:` line survives.
    assert.doesNotMatch(installed, /^model:/m)
    // Every other frontmatter line is present, in order, and the body is untouched.
    assert.equal(
      installed,
      "---\ndescription: x\nmode: primary\ntemperature: 0.3\n---\n# orchestrator\n",
    )
  })

  test("keeps model lines when noAutoModel is omitted", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.strippedModels, 0)

    const orchestrator = readFileSync(join(targetDir, "agents", "orchestrator.md"), "utf-8")
    const extra = readFileSync(join(targetDir, "agents", "extra.md"), "utf-8")

    assert.match(orchestrator, /^model: opencode-go\/deepseek-v4\.1-flash$/m)
    assert.match(extra, /^model: opencode-go\/another-model$/m)
  })

  test("strips a CRLF model line without leaving blank-line residue", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")

    install({ srcRoot, targetDir, noAutoModel: true })

    const installed = readFileSync(join(targetDir, "agents", "extra.md"), "utf-8")

    assert.equal(installed, "---\r\ndescription: extra\r\nmode: subagent\r\n---\r\n# extra\r\n")
    assert.doesNotMatch(installed, /^model:/m)
    assert.doesNotMatch(installed, /\r\n\r\n/)

    // Every remaining line still ends with a CRLF.
    for (const line of installed.split("\n").filter((value) => value.length > 0)) {
      assert.ok(line.endsWith("\r"), `line missing CR: ${JSON.stringify(line)}`)
    }
  })

  test("idempotent: a second run is a no-op that produces identical files", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")

    const first = install({ srcRoot, targetDir, noAutoModel: true })
    assert.equal(first.strippedModels, 2)

    const snapshot = (): string =>
      readFileSync(join(targetDir, "agents", "orchestrator.md"), "utf-8") +
      "\u0000" +
      readFileSync(join(targetDir, "agents", "extra.md"), "utf-8")
    const before = snapshot()

    // Must not throw; a second copy+strip pass must land on identical bytes.
    const second = install({ srcRoot, targetDir, noAutoModel: true })
    assert.equal(second.action, "updated")

    assert.equal(snapshot(), before)
  })

  test("follows a symlinked agents directory when stripping models", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const realAgents = tempDir("opencode-kit-install-real-agents-")

    symlinkSync(realAgents, join(targetDir, "agents"), "dir")

    const result = install({ srcRoot, targetDir, noAutoModel: true })

    assert.equal(result.strippedModels, 2)
    assert.ok(lstatSync(join(targetDir, "agents")).isSymbolicLink())
    assert.equal(realpathSync(join(targetDir, "agents")), realpathSync(realAgents))
    assert.ok(existsSync(join(realAgents, "orchestrator.md")))
    assert.doesNotMatch(readFileSync(join(realAgents, "orchestrator.md"), "utf-8"), /^model:/m)
    assert.doesNotMatch(readFileSync(join(realAgents, "extra.md"), "utf-8"), /^model:/m)
  })

  test("leaves non-Markdown files in agents untouched", () => {
    const srcRoot = makePackageRoot()
    writeFileSync(join(srcRoot, "agents", "notes.txt"), "model: keep-me\n# notes\n")
    const targetDir = tempDir("opencode-kit-install-target-")

    const result = install({ srcRoot, targetDir, noAutoModel: true })

    assert.equal(result.strippedModels, 2)
    assert.equal(
      readFileSync(join(targetDir, "agents", "notes.txt"), "utf-8"),
      "model: keep-me\n# notes\n",
    )
  })
})

describe("stripFrontmatterModel", () => {
  test("returns null when there is no frontmatter", () => {
    assert.equal(stripFrontmatterModel("# heading\nmodel: nope\n"), null)
  })

  test("returns null when the frontmatter has no model line", () => {
    assert.equal(stripFrontmatterModel("---\ndescription: x\n---\n# a\n"), null)
  })

  test("returns null when model appears only after the closing fence", () => {
    assert.equal(stripFrontmatterModel("---\ndescription: x\n---\nmodel: y\n"), null)
  })

  test("returns null for an indented model line (column 0 only)", () => {
    const content = "---\ndescription: x\n  model: y\n---\n# a\n"
    assert.equal(stripFrontmatterModel(content), null)
  })

  test("returns null for an unclosed frontmatter block", () => {
    assert.equal(stripFrontmatterModel("---\ndescription: x\nmodel: y\n"), null)
  })
})
