// Codex CLI detection — used by onboarding to check whether the local
// Codex CLI (https://chatgpt.com/codex) is installed and likely logged in.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface CodexStatus {
  installed: boolean
  /** Best-effort: presence of ~/.codex/auth.json. Definitive check is the first query. */
  loggedInHint: boolean
}

/** True when the output of `codex --version` looks like a real version line. */
export function parseCodexVersionOutput(output: string): boolean {
  return /codex[a-z-]*\s+\d+\.\d+/i.test(output.trim())
}

export function codexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json')
}

export function checkCodexInstalled(timeoutMs = 5000): Promise<CodexStatus> {
  const cmd = process.platform === 'win32' ? 'codex.cmd' : 'codex'
  return new Promise((resolve) => {
    let out = ''

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, ['--version'], { windowsHide: true })
    } catch {
      resolve({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
      return
    }

    let settledNow = false
    const finish = (status: CodexStatus) => {
      if (settledNow) return
      settledNow = true
      clearTimeout(timer)
      resolve(status)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      out += d.toString('utf8')
    })

    child.on('error', () => {
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    })

    child.on('close', () => {
      finish({ installed: parseCodexVersionOutput(out), loggedInHint: existsSync(codexAuthPath()) })
    })
  })
}
