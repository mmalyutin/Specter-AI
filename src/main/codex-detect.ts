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
  return /\bcodex[a-z-]*\s+\d+\.\d+/i.test(output.trim())
}

export function codexAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
}

export function checkCodexInstalled(timeoutMs = 5000): Promise<CodexStatus> {
  return checkCommandInstalled(process.platform === 'win32' ? 'codex.cmd' : 'codex', timeoutMs)
}

/** Test hook: check an arbitrary command instead of codex. */
export function checkCommandInstalled(cmd: string, timeoutMs = 5000): Promise<CodexStatus> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []

    let child: ReturnType<typeof spawn>
    try {
      // Node 20+ throws EINVAL synchronously when spawning .cmd/.bat with args
      // unless shell:true. Args are a constant ('--version') — no injection surface.
      child = spawn(cmd, ['--version'], {
        shell: process.platform === 'win32',
        windowsHide: true
      })
    } catch {
      resolve({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
      return
    }

    let settled = false
    const finish = (status: CodexStatus) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(status)
    }

    const timer = setTimeout(() => {
      if (process.platform === 'win32') {
        // Tree-kill: .cmd spawns a shell, so kill the whole process tree.
        spawn('taskkill', ['/pid', String(child.pid ?? 0), '/T', '/F'], {
          windowsHide: true
        }).on('error', () => {})
      } else {
        child.kill('SIGKILL')
      }
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => {
      chunks.push(d)
    })
    child.stderr?.on('data', (d: Buffer) => {
      chunks.push(d)
    })

    child.on('error', () => {
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    })

    child.on('close', () => {
      const out = Buffer.concat(chunks).toString('utf8')
      finish({ installed: parseCodexVersionOutput(out), loggedInHint: existsSync(codexAuthPath()) })
    })
  })
}
