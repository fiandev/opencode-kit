import type { AgentType } from "../types/enitities"
import { version, name } from "../../package.json"

// Package metadata used by the update check
export const PACKAGE_NAME = name
export const CURRENT_VERSION = version

// Free-tier fallback sent on every request so the router can recover when the
// current model is unavailable or rate-limited.
export const FALLBACK_MODEL = "opencode-go/deepseek-v4.1-flash-free"

/** Agents that must never modify files. */
export const READ_ONLY_AGENTS: readonly AgentType[] = [
  "orchestrator",
  "analyst",
  "architect",
  "tester",
  "reviewer",
  "security",
  "pentester",
  "pr-reviewer",
  "version-analyzer",
]
