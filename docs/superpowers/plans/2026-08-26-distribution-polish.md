# Distribution & Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved distribution-polish spec: first-run onboarding wizard, auto-update, download website, and Windows signing CI wiring.

**Architecture:** Four sequenced workstreams on the existing Electron + React + TypeScript codebase. The wizard is a new framed window + renderer entry reusing the existing preload bridge and IPC patterns; updates use `electron-updater` against the existing GitHub Releases publish config; the site is static HTML/CSS/JS in `/site` deployed by GitHub Pages; signing is conditional env-var wiring in `build.yml`.

**Tech Stack:** Electron 34, electron-vite, React 18, TypeScript, electron-store, electron-updater (new), vitest (new, dev-only), GitHub Actions/Pages.

**Spec:** `docs/superpowers/specs/2026-08-26-distribution-polish-design.md`

**Testing note:** This repo has no test framework. We add vitest for pure logic (key detection, codex version parsing, website OS detection) and use `npm run typecheck` + explicit manual verification steps for window/UI/CI wiring that cannot be unit-tested without Electron infrastructure.

---

### Task 1: Test infrastructure (vitest)

**Files:**
- Modify: `package.json` (scripts, devDependencies)
- Create: `tests/.gitkeep`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to package.json**

In `package.json` scripts block, after `"typecheck": "tsc --noEmit",` add:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Create tests directory**

```bash
mkdir -p tests && touch tests/.gitkeep
```

- [ ] **Step 4: Verify vitest runs with zero tests (exit 0)**

Run: `npm test`
Expected: exits 0 (vitest passes with no test files when none match, prints "No test files found")

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/.gitkeep
git commit -m "chore: add vitest test infrastructure"
```

---

### Task 2: API key type detection util (TDD)

**Files:**
- Test: `tests/detect-key.test.ts`
- Create: `src/shared/detect-key.ts`

Used by the onboarding Connect step to auto-switch provider cards when the user pastes a key of the wrong type.

- [ ] **Step 1: Write the failing test**

Create `tests/detect-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { detectApiKeyType } from '../src/shared/detect-key'

describe('detectApiKeyType', () => {
  it('detects OpenRouter keys by sk-or- prefix', () => {
    expect(detectApiKeyType('sk-or-v1-abc123def456')).toBe('openrouter')
  })

  it('detects OpenAI project keys by sk-proj- prefix', () => {
    expect(detectApiKeyType('sk-proj-abcdef123456')).toBe('openai')
  })

  it('detects legacy OpenAI keys (sk- followed by long token)', () => {
    expect(detectApiKeyType('sk-abc123def456ghi789jkl012')).toBe('openai')
  })

  it('detects OpenAI service-account keys', () => {
    expect(detectApiKeyType('sk-svcacct-abc123')).toBe('openai')
  })

  it('trims whitespace before detecting', () => {
    expect(detectApiKeyType('  sk-or-v1-xyz  ')).toBe('openrouter')
  })

  it('returns unknown for garbage input', () => {
    expect(detectApiKeyType('hello world')).toBe('unknown')
    expect(detectApiKeyType('')).toBe('unknown')
    expect(detectApiKeyType('sk-short')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/shared/detect-key`

- [ ] **Step 3: Write the implementation**

Create `src/shared/detect-key.ts`:

```typescript
// Detect which AI provider an API key belongs to, based on key prefixes.
// Used by onboarding to auto-switch provider cards when the pasted key
// doesn't match the selected provider.
export type DetectedProvider = 'openrouter' | 'openai' | 'unknown'

export function detectApiKeyType(key: string): DetectedProvider {
  const k = key.trim()
  if (k.startsWith('sk-or-')) return 'openrouter'
  if (k.startsWith('sk-proj-') || k.startsWith('sk-svcacct-')) return 'openai'
  // Legacy OpenAI secret keys: "sk-" + long alphanumeric token (no dashes right after sk-)
  if (/^sk-[a-zA-Z0-9]{20,}$/.test(k)) return 'openai'
  return 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 6 tests in `detect-key.test.ts`

- [ ] **Step 5: Commit**

```bash
git add tests/detect-key.test.ts src/shared/detect-key.ts
git commit -m "feat(onboarding): add API key provider detection util"
```

---

### Task 3: Codex CLI detection util (TDD for parser)

**Files:**
- Test: `tests/codex-detect.test.ts`
- Create: `src/main/codex-detect.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/codex-detect.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseCodexVersionOutput } from '../src/main/codex-detect'

describe('parseCodexVersionOutput', () => {
  it('accepts codex version strings like "codex-cli 0.1.2"', () => {
    expect(parseCodexVersionOutput('codex-cli 0.1.2')).toBe(true)
  })

  it('accepts "codex 1.2.3"', () => {
    expect(parseCodexVersionOutput('codex 1.2.3')).toBe(true)
  })

  it('ignores surrounding whitespace and newlines', () => {
    expect(parseCodexVersionOutput('\n  codex 0.9.0 \n')).toBe(true)
  })

  it('rejects error output', () => {
    expect(parseCodexVersionOutput('command not found')).toBe(false)
    expect(parseCodexVersionOutput('')).toBe(false)
    expect(parseCodexVersionOutput('some random output')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/main/codex-detect`

Note: `src/main/codex-detect.ts` imports `electron`-adjacent node builtins (`child_process`, `fs`, `os`, `path`) — all available in vitest's node environment; nothing from `electron` itself is imported, so the module loads in tests.

- [ ] **Step 3: Write the implementation**

Create `src/main/codex-detect.ts`:

```typescript
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
    let settled = false
    const finish = (status: CodexStatus) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(status)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, ['--version'], { windowsHide: true })
    } catch {
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
      return
    }

    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
    child.stderr?.on('data', (d: Buffer) => { out += d.toString('utf8') })

    child.on('error', () => {
      finish({ installed: false, loggedInHint: existsSync(codexAuthPath()) })
    })

    child.on('close', () => {
      finish({ installed: parseCodexVersionOutput(out), loggedInHint: existsSync(codexAuthPath()) })
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests total (4 new + previous 6 minus none — all green)

- [ ] **Step 5: Commit**

```bash
git add tests/codex-detect.test.ts src/main/codex-detect.ts
git commit -m "feat(onboarding): add Codex CLI detection util"
```

---

### Task 4: Settings, types, and IPC channel groundwork

**Files:**
- Modify: `src/shared/types.ts:3-33` (UserSettings)
- Modify: `src/shared/constants.ts:98-122` (DEFAULT_SETTINGS)
- Modify: `src/shared/ipc-channels.ts` (channel registry)
- Modify: `src/services/store.ts:46-81` (validators), `:134-176` (schema), `:255-281` (getAllSettings)

- [ ] **Step 1: Add `onboardingComplete` to UserSettings**

In `src/shared/types.ts`, inside `interface UserSettings`, add as the last field before the closing brace (after `smartCrop: boolean`):

```typescript
  // Onboarding
  onboardingComplete: boolean
```

- [ ] **Step 2: Add default to DEFAULT_SETTINGS**

In `src/shared/constants.ts`, in `DEFAULT_SETTINGS`, after `smartCrop: false`:

```typescript
  ,onboardingComplete: false
```

(Write it as `onboardingComplete: false` with a preceding comma on the `smartCrop` line — match existing style.)

- [ ] **Step 3: Add IPC channels**

In `src/shared/ipc-channels.ts`, add to `IPC_CHANNELS` before the `// App` section:

```typescript
  // Onboarding
  ONBOARDING_COMPLETE: 'onboarding:complete',
  ONBOARDING_CHECK_CODEX: 'onboarding:check-codex',

  // Updates
  UPDATE_STATUS: 'update:status',
```

And in the existing `// App` section, after `APP_VERSION: 'app:version'`:

```typescript
  ,APP_INSTALL_UPDATE: 'app:install-update'
```

- [ ] **Step 4: Add validator + schema + getAllSettings entry in store.ts**

In `src/services/store.ts`:

4a. In `SETTINGS_KEY_VALIDATORS` (after the `smartCrop` line):

```typescript
  ,onboardingComplete: (v) => typeof v === 'boolean'
```

4b. In the `schema` object (after `smartCrop`):

```typescript
  ,onboardingComplete: { type: 'boolean' as const, default: DEFAULT_SETTINGS.onboardingComplete }
```

4c. In `getAllSettings()` return object (after `smartCrop`):

```typescript
      ,onboardingComplete: s.get('onboardingComplete') as boolean
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If it complains about a missing `onboardingComplete` in a `UserSettings` literal, only `getAllSettings` constructs that type — the addition in 4c fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts src/shared/ipc-channels.ts src/services/store.ts
git commit -m "feat(onboarding): add onboardingComplete setting and new IPC channels"
```

---

### Task 5: Onboarding window (main process) + preload API

**Files:**
- Create: `src/main/onboarding-window.ts`
- Modify: `src/preload/index.ts` (SpecterAPI interface + implementation)

- [ ] **Step 1: Create the onboarding window module**

Create `src/main/onboarding-window.ts`:

```typescript
// Onboarding window — first-run setup wizard.
// Framed, centered, normal window (mirrors dashboard-window.ts patterns).
// Registers its own IPC handlers because the wizard owns its lifecycle:
//   onboarding:complete     → mark onboarded (unless skipped), close, show overlay
//   onboarding:check-codex  → detect local Codex CLI install/login
import { BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { setSetting, getSetting } from '../services/store'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { showOverlay } from './overlay-window'
import { checkCodexInstalled } from './codex-detect'

let onboardingWindow: BrowserWindow | null = null
let handlersRegistered = false

function registerOnboardingHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on(IPC_CHANNELS.ONBOARDING_COMPLETE, (_event, skipped: unknown) => {
    if (skipped !== true) {
      setSetting('onboardingComplete', true)
    }
    closeOnboardingWindow()
  })

  ipcMain.handle(IPC_CHANNELS.ONBOARDING_CHECK_CODEX, () => checkCodexInstalled())
}

export function createOnboardingWindow(): BrowserWindow {
  registerOnboardingHandlers()

  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus()
    return onboardingWindow
  }

  onboardingWindow = new BrowserWindow({
    width: 680,
    height: 560,
    minWidth: 680,
    minHeight: 560,
    title: 'Specter AI — Welcome',
    frame: true,
    resizable: false,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false // Required: @electron-toolkit/preload uses Node APIs in preload
    }
  })

  // Whatever way the window closes (Finish, Skip, or the titlebar X),
  // make sure the user is never stranded: show the overlay. The Finish
  // path sets onboardingComplete=true first, so re-running the wizard
  // stays possible from the tray for skipped users.
  onboardingWindow.on('closed', () => {
    onboardingWindow = null
    showOverlay()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    onboardingWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/onboarding/index.html`)
  } else {
    onboardingWindow.loadFile(path.join(__dirname, '../renderer/onboarding/index.html'))
  }

  // --- Security: block navigation and new windows (same policy as dashboard) ---
  onboardingWindow.webContents.on('will-navigate', (event, url) => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) {
      return
    }
    console.warn('[Specter] Blocked onboarding navigation to:', url)
    event.preventDefault()
  })

  onboardingWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  return onboardingWindow
}

export function closeOnboardingWindow(): void {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    // 'closed' handler shows the overlay
    onboardingWindow.close()
  }
}

export function getOnboardingWindow(): BrowserWindow | null {
  return onboardingWindow
}
```

Note: `getSetting` is imported but unused in this file — remove it from the import to keep typecheck/lint clean. Final import line:

```typescript
import { setSetting } from '../services/store'
```

- [ ] **Step 2: Add preload API methods**

In `src/preload/index.ts`:

2a. In the `SpecterAPI` interface, after the `onOpacityChange` declaration:

```typescript
  // Onboarding
  completeOnboarding: (skipped?: boolean) => void
  checkCodex: () => Promise<{ installed: boolean; loggedInHint: boolean }>

  // Updates
  onUpdateStatus: (callback: (data: { version: string; ready: boolean }) => void) => () => void
  installUpdate: () => void
```

2b. In the `api` object implementation, after the `onOpacityChange` entry:

```typescript
  ,

  // Onboarding
  completeOnboarding: (skipped) => {
    ipcRenderer.send(IPC_CHANNELS.ONBOARDING_COMPLETE, skipped === true)
  },
  checkCodex: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_CHECK_CODEX) as Promise<{ installed: boolean; loggedInHint: boolean }>
  },

  // Updates
  onUpdateStatus: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const d = data as Record<string, unknown>
        if (typeof d.version === 'string' && typeof d.ready === 'boolean') {
          callback({ version: d.version, ready: d.ready })
        }
      }
    }
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler)
  },
  installUpdate: () => {
    ipcRenderer.send(IPC_CHANNELS.APP_INSTALL_UPDATE)
  }
```

(Update-task Step 2 in Task 12 references these same entries — they are being added once here, covering both features.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/main/onboarding-window.ts src/preload/index.ts
git commit -m "feat(onboarding): add onboarding window and preload API"
```

---

### Task 6: Wire app entry + tray

**Files:**
- Modify: `src/main/index.ts:61-76`
- Modify: `src/main/tray.ts:26-52` (menu), `:1-6` (imports)

- [ ] **Step 1: Show onboarding instead of overlay for fresh installs**

In `src/main/index.ts`, change the block:

```typescript
  // Create the overlay window
  const overlay = createOverlayWindow()

  // Register IPC handlers
  registerIpcHandlers(overlay)

  // Register global hotkeys
  registerHotkeys(overlay)
```

to:

```typescript
  // Create the overlay window (hotkeys, tray, and IPC need it to exist)
  const overlay = createOverlayWindow()

  // Register IPC handlers
  registerIpcHandlers(overlay)

  // Register global hotkeys
  registerHotkeys(overlay)
```

And after the `createTray()` line (which stays where it is), add:

```typescript
  // First run: show the onboarding wizard instead of the bare overlay.
  // The overlay is still created (tray/hotkeys depend on it) but hidden;
  // the wizard shows it when the user finishes or skips.
  const onboarded = getSetting<boolean>('onboardingComplete')
  if (!onboarded) {
    overlay.hide()
    createOnboardingWindow()
  }
```

Update the imports at the top of `src/main/index.ts`:

```typescript
import { registerIpcHandlers } from './ipc-handlers'
import { createOnboardingWindow } from './onboarding-window'
import { getSetting } from '../services/store'
```

- [ ] **Step 2: Add "Run Setup Wizard" tray item**

In `src/main/tray.ts`, add to imports:

```typescript
import { createOnboardingWindow } from './onboarding-window'
```

In the `contextMenu` template, after the `Settings` entry and before its trailing separator, add:

```typescript
    ,
    {
      label: 'Run Setup Wizard',
      click: () => createOnboardingWindow()
    }
```

(The template entry order becomes: Show Overlay, Hide Overlay, Toggle Overlay, separator, Settings, Run Setup Wizard, separator, Quit.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/tray.ts
git commit -m "feat(onboarding): show setup wizard on first run, add tray entry"
```

---

### Task 7: Onboarding renderer scaffolding

**Files:**
- Modify: `electron.vite.config.ts:35-37` (renderer inputs)
- Create: `src/renderer/onboarding/index.html`
- Create: `src/renderer/onboarding/main.tsx`
- Create: `src/renderer/onboarding/App.tsx`
- Create: `src/renderer/onboarding/steps/` (directory; component files arrive in Tasks 8–9)

- [ ] **Step 1: Register the renderer entry**

In `electron.vite.config.ts`, renderer `rollupOptions.input`, add:

```typescript
          onboarding: resolve(__dirname, 'src/renderer/onboarding/index.html')
```

- [ ] **Step 2: Create index.html**

Create `src/renderer/onboarding/index.html` (CSP mirrors the dashboard — `connect-src` must include `api.openai.com` for key validation):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://openrouter.ai https://api.groq.com https://api.openai.com; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';" />
    <title>Specter AI — Welcome</title>
  </head>
  <body class="bg-specter-darker text-white">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create main.tsx**

Create `src/renderer/onboarding/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 4: Create App.tsx (step state machine)**

Create `src/renderer/onboarding/App.tsx`:

```tsx
// Onboarding App — first-run setup wizard for Specter AI
import { useState } from 'react'
import { Ghost } from 'lucide-react'
import Welcome from './steps/Welcome'
import ChooseProvider from './steps/ChooseProvider'
import Connect from './steps/Connect'
import PickModel from './steps/PickModel'
import TestStep from './steps/TestStep'
import Done from './steps/Done'

declare global {
  interface Window {
    specterAPI: import('../../preload/index').SpecterAPI
  }
}

export type ProviderId = 'openrouter' | 'openai' | 'codex'

const STEP_COUNT = 6

export default function App() {
  const [step, setStep] = useState(0)
  const [provider, setProvider] = useState<ProviderId>('openrouter')

  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  return (
    <div className="w-screen h-screen bg-specter-darker text-white flex flex-col overflow-hidden">
      {/* Header — Skip is always available (fast lane for technical users) */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Ghost className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-semibold text-white/80">Specter AI Setup</span>
        </div>
        {step < STEP_COUNT - 1 && (
          <button
            onClick={() => window.specterAPI?.completeOnboarding(true)}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Skip — I&apos;ll set up later
          </button>
        )}
      </header>

      {/* Step content */}
      <main className="flex-1 overflow-y-auto">
        {step === 0 && <Welcome onNext={next} onSkip={() => window.specterAPI?.completeOnboarding(true)} />}
        {step === 1 && (
          <ChooseProvider provider={provider} onSelect={setProvider} onNext={next} />
        )}
        {step === 2 && (
          <Connect provider={provider} onProviderChange={setProvider} onNext={next} onBack={back} />
        )}
        {step === 3 && <PickModel provider={provider} onNext={next} onBack={back} />}
        {step === 4 && <TestStep onNext={next} onBack={back} />}
        {step === 5 && <Done onFinish={() => window.specterAPI?.completeOnboarding(false)} />}
      </main>

      {/* Progress dots */}
      <footer className="flex items-center justify-center gap-2 py-4 border-t border-white/5 shrink-0">
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i === step ? 'bg-violet-400' : i < step ? 'bg-violet-400/40' : 'bg-white/10'
            }`}
          />
        ))}
      </footer>
    </div>
  )
}
```

- [ ] **Step 5: Create steps directory placeholder**

```bash
mkdir -p src/renderer/onboarding/steps
```

(The build will fail to resolve step imports until Tasks 8–9 — do not run `npm run build` yet; `npm run typecheck` will also flag missing modules. That is expected until Task 9 completes.)

- [ ] **Step 6: Commit (work-in-progress, tree intentionally incomplete until Task 9)**

```bash
git add electron.vite.config.ts src/renderer/onboarding
git commit -m "feat(onboarding): wizard renderer scaffolding and step state machine"
```

---

### Task 8: Wizard steps — Welcome, ChooseProvider, Connect

**Files:**
- Create: `src/renderer/onboarding/steps/Welcome.tsx`
- Create: `src/renderer/onboarding/steps/ChooseProvider.tsx`
- Create: `src/renderer/onboarding/steps/Connect.tsx`

- [ ] **Step 1: Create Welcome.tsx**

```tsx
import { Ghost, ArrowRight } from 'lucide-react'

interface Props {
  onNext: () => void
  onSkip: () => void
}

export default function Welcome({ onNext, onSkip }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-violet-500/20 flex items-center justify-center mb-6">
        <Ghost className="w-8 h-8 text-violet-400" />
      </div>
      <h1 className="text-2xl font-bold mb-3">Your invisible AI copilot</h1>
      <p className="text-sm text-white/50 max-w-md mb-2">
        Specter AI reads your screen and meeting audio, then answers in an overlay
        only you can see — invisible to Zoom, Meet, and Teams screen sharing.
      </p>
      <p className="text-xs text-white/30 max-w-md mb-8">
        Setup takes about 2 minutes: connect an AI provider, pick a model, test it.
      </p>

      {/* Product visual — a mock overlay card */}
      <div className="w-64 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 mb-8 text-left">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-violet-400" />
          <span className="text-[10px] text-violet-300/70 font-medium">Specter overlay</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-2 rounded bg-white/10 w-full" />
          <div className="h-2 rounded bg-white/10 w-4/5" />
          <div className="h-2 rounded bg-violet-400/30 w-3/5" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium transition-colors"
        >
          Get started <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onSkip}
          className="px-4 py-2.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Skip — I&apos;ll set up later
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ChooseProvider.tsx**

```tsx
import { Globe, KeyRound, Terminal, ArrowRight } from 'lucide-react'
import type { ProviderId } from '../App'

interface Props {
  provider: ProviderId
  onSelect: (p: ProviderId) => void
  onNext: () => void
}

const PROVIDERS: Array<{
  id: ProviderId
  title: string
  desc: string
  badge?: string
  icon: typeof Globe
}> = [
  {
    id: 'openrouter',
    title: 'OpenRouter',
    desc: 'Access 500+ models (GPT, Claude, Gemini, Llama) with one key. Free models available.',
    badge: 'Recommended',
    icon: Globe
  },
  {
    id: 'openai',
    title: 'OpenAI',
    desc: 'Use OpenAI Platform API credits directly (pay per use).',
    icon: KeyRound
  },
  {
    id: 'codex',
    title: 'Codex Plan',
    desc: 'Use your local Codex CLI login (ChatGPT Plus/Pro plan). No API key needed.',
    icon: Terminal
  }
]

export default function ChooseProvider({ provider, onSelect, onNext }: Props) {
  return (
    <div className="max-w-lg mx-auto px-8 py-8">
      <h2 className="text-lg font-semibold mb-1">Choose your AI provider</h2>
      <p className="text-xs text-white/40 mb-6">You can change this anytime in Settings.</p>

      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const Icon = p.icon
          const active = provider === p.id
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
                active
                  ? 'border-violet-500/60 bg-violet-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  active ? 'bg-violet-500/20' : 'bg-white/5'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-violet-300' : 'text-white/40'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  {p.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">
                      {p.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/40 mt-1">{p.desc}</p>
              </div>
              <div
                className={`w-4 h-4 rounded-full border mt-1 shrink-0 ${
                  active ? 'border-violet-400 bg-violet-400' : 'border-white/20'
                }`}
              />
            </button>
          )
        })}
      </div>

      <button
        onClick={onNext}
        className="mt-6 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium transition-colors"
      >
        Continue <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create Connect.tsx**

```tsx
import { useState, useEffect } from 'react'
import { ArrowRight, ArrowLeft, ExternalLink, Check, Loader2, Terminal, Mic } from 'lucide-react'
import { detectApiKeyType } from '../../../shared/detect-key'
import { OPENROUTER_KEYS_URL, OPENAI_API_KEYS_URL } from '../../../shared/constants'
import type { ProviderId } from '../App'

interface Props {
  provider: ProviderId
  onProviderChange: (p: ProviderId) => void
  onNext: () => void
  onBack: () => void
}

export default function Connect({ provider, onProviderChange, onNext, onBack }: Props) {
  return (
    <div className="max-w-lg mx-auto px-8 py-8">
      {provider === 'codex' ? (
        <CodexConnect onNext={onNext} onBack={onBack} />
      ) : (
        <KeyConnect
          provider={provider}
          onProviderChange={onProviderChange}
          onNext={onNext}
          onBack={onBack}
        />
      )}
    </div>
  )
}

function KeyConnect({ provider, onProviderChange, onNext, onBack }: Props) {
  const [key, setKey] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [valid, setValid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [groqKey, setGroqKey] = useState('')
  const [groqSaved, setGroqSaved] = useState(false)

  const isRouter = provider === 'openrouter'

  function onChange(value: string) {
    setKey(value)
    setValid(false)
    setError(null)
    const detected = detectApiKeyType(value)
    if (detected !== 'unknown' && detected !== provider) {
      onProviderChange(detected)
      setNote(`That looks like ${detected === 'openrouter' ? 'an OpenRouter' : 'an OpenAI'} key — switched for you.`)
    } else {
      setNote(null)
    }
  }

  async function validate() {
    setValidating(true)
    setError(null)
    try {
      if (isRouter) {
        await window.specterAPI?.setSetting('openrouterApiKey', key.trim())
        await window.specterAPI?.fetchModels()
      } else {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key.trim()}` }
        })
        if (!res.ok) {
          throw new Error(res.status === 401 ? 'Invalid OpenAI API key.' : `OpenAI error ${res.status}`)
        }
        await window.specterAPI?.setSetting('openaiApiKey', key.trim())
      }
      await window.specterAPI?.setSetting('aiProvider', provider)
      setValid(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Validation failed'
      setError(msg)
      // Remove a bad OpenRouter key so the app isn't left in a broken state
      if (isRouter) await window.specterAPI?.setSetting('openrouterApiKey', '').catch(() => {})
    } finally {
      setValidating(false)
    }
  }

  async function saveGroq() {
    if (!groqKey.trim()) return
    await window.specterAPI?.setSetting('whisperProvider', 'groq')
    await window.specterAPI?.setSetting('whisperApiKey', groqKey.trim())
    setGroqSaved(true)
  }

  return (
    <>
      <h2 className="text-lg font-semibold mb-1">Connect {isRouter ? 'OpenRouter' : 'OpenAI'}</h2>
      <p className="text-xs text-white/40 mb-4">
        Paste your API key. It&apos;s stored encrypted on your machine — never uploaded anywhere.
      </p>

      <button
        onClick={() =>
          window.specterAPI?.openExternal(isRouter ? OPENROUTER_KEYS_URL : OPENAI_API_KEYS_URL)
        }
        className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200 mb-3"
      >
        Get your key {isRouter ? '(openrouter.ai)' : '(platform.openai.com)'}
        <ExternalLink className="w-3 h-3" />
      </button>

      <input
        type="password"
        value={key}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isRouter ? 'sk-or-v1-...' : 'sk-proj-...'}
        spellCheck={false}
        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-mono
                   focus:outline-none focus:border-violet-500/60 placeholder:text-white/20"
      />

      {note && <p className="text-xs text-violet-300/80 mt-2">{note}</p>}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {!valid ? (
        <button
          onClick={validate}
          disabled={key.trim().length < 10 || validating}
          className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                     bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed
                     text-sm font-medium transition-colors"
        >
          {validating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Validating...
            </>
          ) : (
            'Validate key'
          )}
        </button>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-xs text-green-400">
          <Check className="w-3.5 h-3.5" /> Key saved and validated.
        </div>
      )}

      {/* Optional: live transcription */}
      {valid && (
        <div className="mt-6 p-4 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2 mb-2">
            <Mic className="w-3.5 h-3.5 text-white/40" />
            <span className="text-xs font-medium text-white/70">Enable live transcription (optional)</span>
          </div>
          <p className="text-[11px] text-white/35 mb-3">
            Transcribes meeting audio via Groq&apos;s free-tier Whisper. Get a free key at console.groq.com.
          </p>
          {groqSaved ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Check className="w-3.5 h-3.5" /> Transcription key saved.
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                spellCheck={false}
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono
                           focus:outline-none focus:border-violet-500/60 placeholder:text-white/20"
              />
              <button
                onClick={saveGroq}
                disabled={groqKey.trim().length < 10}
                className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40
                           text-xs transition-colors"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10
                     text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                     bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed
                     text-sm font-medium transition-colors"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </>
  )
}

function CodexConnect({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<{ installed: boolean; loggedInHint: boolean } | null>(null)

  useEffect(() => {
    window.specterAPI?.checkCodex().then(setStatus).catch(() => setStatus({ installed: false, loggedInHint: false }))
  }, [])

  return (
    <>
      <h2 className="text-lg font-semibold mb-1">Connect Codex</h2>
      <p className="text-xs text-white/40 mb-6">
        Specter uses your local Codex CLI login — no API key needed.
      </p>

      <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 mb-3">
          <Terminal className="w-4 h-4 text-white/40" />
          <span className="text-sm font-medium">
            {status === null ? 'Checking for Codex CLI...' : status.installed ? 'Codex CLI detected' : 'Codex CLI not found'}
          </span>
          {status?.installed && <Check className="w-4 h-4 text-green-400" />}
        </div>

        {status === null && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking for `codex` on your system...
          </div>
        )}

        {status !== null && !status.installed && (
          <div className="text-xs text-white/40 space-y-2">
            <p>Install it, log in, then come back:</p>
            <code className="block px-3 py-2 rounded-lg bg-black/40 font-mono text-[11px] text-violet-300">
              npm install -g @openai/codex
            </code>
            <code className="block px-3 py-2 rounded-lg bg-black/40 font-mono text-[11px] text-violet-300">
              codex login
            </code>
          </div>
        )}

        {status?.installed && (
          <p className="text-xs text-white/40">
            {status.loggedInHint
              ? 'Login detected. Ready to use your ChatGPT plan.'
              : 'Installed, but login not detected — run `codex login` if your first query fails.'}
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10
                     text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!status?.installed}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                     bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed
                     text-sm font-medium transition-colors"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/onboarding/steps
git commit -m "feat(onboarding): welcome, provider selection, and connect steps"
```

(Build still incomplete until Task 9 — TestStep/PickModel/Done are referenced by App.tsx.)

---

### Task 9: Wizard steps — PickModel, TestStep, Done

**Files:**
- Create: `src/renderer/onboarding/steps/PickModel.tsx`
- Create: `src/renderer/onboarding/steps/TestStep.tsx`
- Create: `src/renderer/onboarding/steps/Done.tsx`

- [ ] **Step 1: Create PickModel.tsx**

```tsx
import { useState, useEffect } from 'react'
import { ArrowRight, ArrowLeft, Check, Zap, Scale, Gift } from 'lucide-react'
import type { ProviderId } from '../App'

interface Props {
  provider: ProviderId
  onNext: () => void
  onBack: () => void
}

interface Choice {
  id: string
  label: string
  desc: string
  icon: typeof Zap
}

const CURATED: Record<ProviderId, Choice[]> = {
  openrouter: [
    { id: 'google/gemini-3-flash-preview', label: 'Fast', desc: 'Ultra-fast responses, great for real-time help', icon: Zap },
    { id: 'anthropic/claude-sonnet-4', label: 'Balanced', desc: 'Top-tier quality and reasoning', icon: Scale },
    { id: 'upstage/solar-pro-3:free', label: 'Free', desc: 'Free tier — perfect for testing', icon: Gift }
  ],
  openai: [
    { id: 'gpt-5.5', label: 'Fast', desc: 'Latest fast flagship model', icon: Zap },
    { id: 'gpt-5.5-pro', label: 'Most capable', desc: 'Highest quality, higher cost', icon: Scale },
    { id: 'gpt-5.4-mini', label: 'Cheapest', desc: 'Small, fast, inexpensive', icon: Gift }
  ],
  codex: [
    { id: 'gpt-5.4', label: 'Your plan', desc: 'Uses your ChatGPT/Codex plan login', icon: Zap }
  ]
}

const MODEL_SETTING: Record<ProviderId, string> = {
  openrouter: 'selectedModel',
  openai: 'openaiModel',
  codex: 'codexModel'
}

export default function PickModel({ provider, onNext, onBack }: Props) {
  const choices = CURATED[provider]
  const [selected, setSelected] = useState<string>(choices[0].id)

  useEffect(() => {
    setSelected(CURATED[provider][0].id)
  }, [provider])

  async function pickAndContinue() {
    await window.specterAPI?.setSetting(MODEL_SETTING[provider], selected)
    onNext()
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-8">
      <h2 className="text-lg font-semibold mb-1">Pick a model</h2>
      <p className="text-xs text-white/40 mb-6">
        You can browse all models later in Settings → Models.
      </p>

      <div className="space-y-3">
        {choices.map((c) => {
          const Icon = c.icon
          const active = selected === c.id
          return (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                active
                  ? 'border-violet-500/60 bg-violet-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  active ? 'bg-violet-500/20' : 'bg-white/5'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-violet-300' : 'text-white/40'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-white/40 mt-0.5">{c.desc}</div>
                <div className="text-[10px] font-mono text-white/25 mt-1">{c.id}</div>
              </div>
              <div
                className={`w-4 h-4 rounded-full border shrink-0 ${
                  active ? 'border-violet-400 bg-violet-400' : 'border-white/20'
                }`}
              />
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10
                     text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button
          onClick={pickAndContinue}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                     bg-violet-600 hover:bg-violet-500 text-sm font-medium transition-colors"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create TestStep.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { ArrowRight, ArrowLeft, Play, Loader2, Check, AlertTriangle } from 'lucide-react'

interface Props {
  onNext: () => void
  onBack: () => void
}

export default function TestStep({ onNext, onBack }: Props) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const api = window.specterAPI
    if (!api) return

    const unsubChunk = api.onStreamChunk((chunk) => {
      setOutput((prev) => prev + chunk)
    })
    const unsubDone = api.onStreamDone(() => {
      setStatus('done')
    })
    const unsubError = api.onStreamError((err) => {
      setError(err)
      setStatus('error')
    })

    return () => {
      unsubChunk()
      unsubDone()
      unsubError()
    }
  }, [])

  function runTest() {
    if (startedRef.current) return
    startedRef.current = true
    setStatus('running')
    setOutput('')
    setError(null)
    window.specterAPI?.queryAI(
      'This is a setup test. Reply with exactly: Specter is ready to help.',
      false,
      false,
      []
    )
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-8">
      <h2 className="text-lg font-semibold mb-1">Test it</h2>
      <p className="text-xs text-white/40 mb-6">
        Send one tiny query through your provider to confirm everything works.
      </p>

      {/* Response box */}
      <div className="min-h-32 p-4 rounded-xl border border-white/10 bg-black/30 font-mono text-xs whitespace-pre-wrap">
        {status === 'idle' && <span className="text-white/25">Response will appear here...</span>}
        {status === 'running' && (
          <span className="text-white/50">
            {output || 'Waiting for first token...'}
            <Loader2 className="w-3 h-3 animate-spin inline ml-1" />
          </span>
        )}
        {(status === 'done' || status === 'error') && output && <span className="text-white/80">{output}</span>}
        {status === 'error' && (
          <div className="flex items-start gap-2 text-red-400 mt-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {status === 'done' && (
        <div className="flex items-center gap-2 text-xs text-green-400 mt-3">
          <Check className="w-3.5 h-3.5" /> Your setup works.
        </div>
      )}

      <div className="flex gap-2 mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10
                     text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        {status !== 'done' ? (
          <button
            onClick={runTest}
            disabled={status === 'running'}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                       bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-sm font-medium transition-colors"
          >
            {status === 'running' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Testing...
              </>
            ) : status === 'error' ? (
              'Retry test'
            ) : (
              <>
                <Play className="w-4 h-4" /> Run test
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                       bg-violet-600 hover:bg-violet-500 text-sm font-medium transition-colors"
          >
            Finish up <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create Done.tsx**

```tsx
import { Keyboard, MousePointerClick, Check } from 'lucide-react'
import { DEFAULT_HOTKEYS } from '../../../shared/constants'

interface Props {
  onFinish: () => void
}

const HOTKEY_LABELS: Array<{ key: string; label: string }> = [
  { key: DEFAULT_HOTKEYS.askAI, label: 'Ask AI with screen context' },
  { key: DEFAULT_HOTKEYS.screenshotAsk, label: 'Ask AI with a screenshot' },
  { key: DEFAULT_HOTKEYS.toggleOverlay, label: 'Show / hide the overlay' },
  { key: DEFAULT_HOTKEYS.toggleAudio, label: 'Start / stop audio transcription' }
]

function prettyKey(k: string): string {
  return k
    .replace('CommandOrControl', 'Ctrl/Cmd')
    .replace('Return', 'Enter')
}

export default function Done({ onFinish }: Props) {
  return (
    <div className="max-w-lg mx-auto px-8 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center">
          <Check className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">You&apos;re all set</h2>
          <p className="text-xs text-white/40">The overlay is ready in the top-right corner.</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Keyboard className="w-4 h-4 text-white/40" />
          <span className="text-sm font-medium text-white/70">Hotkeys</span>
        </div>
        <div className="space-y-2">
          {HOTKEY_LABELS.map((h) => (
            <div key={h.key} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.03]">
              <span className="text-xs text-white/60">{h.label}</span>
              <code className="text-[11px] px-2 py-1 rounded bg-black/40 font-mono text-violet-300">
                {prettyKey(h.key)}
              </code>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 text-xs text-white/35">
        <MousePointerClick className="w-3.5 h-3.5" />
        <span>Tip: right-click the tray icon for Settings, the setup wizard, and Quit.</span>
      </div>

      <button
        onClick={onFinish}
        className="mt-6 w-full px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                   text-sm font-medium transition-colors"
      >
        Start using Specter
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: both exit 0 (all step modules now resolve)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/onboarding/steps
git commit -m "feat(onboarding): model picker, live test, and done steps"
```

---

### Task 10: Onboarding verification (fresh profile)

**Files:** none (verification only)

- [ ] **Step 1: Build check**

Run: `npm run build`
Expected: exit 0 — `out/renderer/onboarding/index.html` exists

- [ ] **Step 2: Fresh-profile manual test (dev)**

Run:
```bash
npm run dev
```

Manual checklist (perform each, verify behavior):
1. Delete/rename `%APPDATA%/specter-ai/specter-settings.json` before launching (simulates fresh install)
2. App opens the **wizard**, not the overlay; tray icon exists
3. Welcome → Get started → provider cards render; select each provider (card highlights)
4. OpenRouter path: paste a garbage key → Validate → inline error shown, Continue stays disabled. Paste a real `sk-or-...` key → validation passes, optional Groq block appears
5. Wrong-key detection: select OpenAI card, paste an `sk-or-` key → card auto-switches to OpenRouter with the note
6. Model step: choices render per provider; Continue saves (verify via Settings dashboard later)
7. Test step: Run test → streamed text appears; error path shows inline error + Retry
8. Done → "Start using Specter" → wizard closes, overlay appears
9. Relaunch app → overlay appears directly (no wizard)
10. Tray → "Run Setup Wizard" → wizard reopens

- [ ] **Step 3: Record results and fix any issues found**

Fix bugs in the step components; re-run `npm run typecheck && npm test` after each fix; commit fixes:

```bash
git add -A && git commit -m "fix(onboarding): fixes from fresh-profile verification pass"
```

(Skip this commit if no fixes were needed.)

---

### Task 11: Auto-updater module

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/main/updater.ts`
- Modify: `src/main/index.ts` (init call)

- [ ] **Step 1: Install electron-updater**

```bash
npm install electron-updater
```

- [ ] **Step 2: Create updater.ts**

Create `src/main/updater.ts`:

```typescript
// Auto-updater — checks GitHub Releases (via electron-updater) using the
// publish config already declared in package.json (provider: github).
// Downloads silently; the overlay shows a restart toast when ready.
// Checks never interrupt usage — install happens only on explicit user action.
import { ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { getOverlayWindow } from './overlay-window'

const INITIAL_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // every 6 hours

let initialized = false

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  // Never check for updates in dev
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Avoids differential-download issues (unsigned delta patches)
  autoUpdater.disableDifferentialDownload = true

  autoUpdater.on('update-downloaded', (info) => {
    const overlay = getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(IPC_CHANNELS.UPDATE_STATUS, {
        version: info.version,
        ready: true
      })
    }
  })

  // Errors are non-fatal: log and retry on the next scheduled check
  autoUpdater.on('error', (err) => {
    console.warn('[Specter] Update check/download failed:', err.message)
  })

  ipcMain.on(IPC_CHANNELS.APP_INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall()
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.warn('[Specter] Update check failed:', err.message)
    })
  }

  setTimeout(check, INITIAL_CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS)
}
```

- [ ] **Step 3: Wire into app entry**

In `src/main/index.ts`, add import:

```typescript
import { initUpdater } from './updater'
```

Inside `app.whenReady().then(() => {`, after `createTray()`, add:

```typescript
  // Auto-update checks (no-op in dev)
  initUpdater()
```

- [ ] **Step 4: Typecheck + test**

Run: `npm run typecheck && npm test`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main/updater.ts src/main/index.ts
git commit -m "feat(update): silent background auto-update via electron-updater"
```

---

### Task 12: Update toast in overlay

**Files:**
- Create: `src/renderer/overlay/UpdateToast.tsx`
- Modify: `src/renderer/overlay/App.tsx` (import + render)

(Preload `onUpdateStatus` / `installUpdate` were already added in Task 5 Step 2.)

- [ ] **Step 1: Create UpdateToast.tsx**

```tsx
// UpdateToast — subtle restart prompt shown when a downloaded update is ready.
import { useState, useEffect } from 'react'
import { RefreshCw, X } from 'lucide-react'

export default function UpdateToast() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const api = window.specterAPI
    if (!api?.onUpdateStatus) return
    return api.onUpdateStatus((data) => {
      if (data.ready && data.version) setVersion(data.version)
    })
  }, [])

  if (!version) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/15 border border-violet-500/30 text-xs">
      <span className="flex-1 text-violet-200">
        v{version} ready — restart to update
      </span>
      <button
        onClick={() => window.specterAPI?.installUpdate()}
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> Restart
      </button>
      <button
        onClick={() => setVersion(null)}
        className="p-1 rounded-lg text-white/40 hover:text-white/80 transition-colors"
        aria-label="Dismiss update notification"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into overlay App.tsx**

In `src/renderer/overlay/App.tsx`:

2a. Add import after the `MeetingRecorder` import:

```typescript
import UpdateToast from './UpdateToast'
```

2b. Find the component's root return element: search for the outermost JSX `return (` in `App` (the one rendering the main overlay container div). Render `<UpdateToast />` as the **first child** inside that root container div, so the toast pins to the top of the overlay when an update is ready. Example — if the root looks like:

```tsx
return (
  <div className="overlay-root ...">
    {/* existing children */}
```

change it to:

```tsx
return (
  <div className="overlay-root ...">
    <UpdateToast />
    {/* existing children */}
```

(Use Grep on `App.tsx` for `return (` and inspect the root container — it is the div with the drag region / main overlay layout. If the overlay renders a minimized pill branch, add `<UpdateToast />` only to the expanded branch.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/renderer/overlay/UpdateToast.tsx src/renderer/overlay/App.tsx
git commit -m "feat(update): overlay restart toast when update is downloaded"
```

---

### Task 13: Download website

**Files:**
- Modify: `package.json` (stable artifact names)
- Create: `site/index.html`
- Create: `site/style.css`
- Create: `site/script.js`
- Test: `tests/site-detect-os.test.ts`
- Create: `.github/workflows/site.yml`

- [ ] **Step 1: Switch to version-less artifact names (stable download URLs)**

In `package.json` `build` config, change artifact names so `releases/latest/download/<name>` URLs never go stale:

```json
    "portable": {
      "artifactName": "specter-portable.${ext}"
    },
```

```json
    "nsis": {
      "artifactName": "specter-setup.${ext}"
    },
```

```json
    "mac": {
      "artifactName": "specter-mac-${arch}.${ext}"
    },
```

```json
    "dmg": {
      "artifactName": "specter-mac-${arch}.${ext}"
    },
```

```json
    "linux": {
      "artifactName": "specter-linux-${arch}.${ext}"
    },
```

(Keep all other keys in those blocks unchanged. Stable names take effect from the next tagged release onward.)

- [ ] **Step 2: Write the failing OS-detection test**

Create `tests/site-detect-os.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { detectOS, DOWNLOAD_URLS } from '../site/script'

describe('detectOS', () => {
  it('detects Windows', () => {
    expect(
      detectOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    ).toBe('windows')
  })

  it('detects macOS', () => {
    expect(
      detectOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    ).toBe('macos')
  })

  it('detects Linux', () => {
    expect(
      detectOS('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
    ).toBe('linux')
  })

  it('defaults to windows for unknown agents', () => {
    expect(detectOS('some-agent/1.0')).toBe('windows')
  })
})

describe('DOWNLOAD_URLS', () => {
  it('uses stable latest-download URLs with the new artifact names', () => {
    const base = 'https://github.com/umairinayat/Specter-AI/releases/latest/download/'
    expect(DOWNLOAD_URLS.windows.setup).toBe(`${base}specter-setup.exe`)
    expect(DOWNLOAD_URLS.macos.arm64).toBe(`${base}specter-mac-arm64.zip`)
    expect(DOWNLOAD_URLS.linux.appimage).toBe(`${base}specter-linux-x64.AppImage`)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../site/script`

- [ ] **Step 4: Create site/script.js**

```javascript
// Specter AI download site logic — ESM module, auto-initializes in the browser.
// Exports are consumed by vitest (tests/site-detect-os.test.ts).

const RELEASES_BASE = 'https://github.com/umairinayat/Specter-AI/releases/latest/download/'

export const DOWNLOAD_URLS = {
  windows: {
    setup: RELEASES_BASE + 'specter-setup.exe',
    portable: RELEASES_BASE + 'specter-portable.exe'
  },
  macos: {
    arm64: RELEASES_BASE + 'specter-mac-arm64.zip',
    x64: RELEASES_BASE + 'specter-mac-x64.zip'
  },
  linux: {
    appimage: RELEASES_BASE + 'specter-linux-x64.AppImage',
    deb: RELEASES_BASE + 'specter-linux-x64.deb'
  }
}

export function detectOS(userAgent) {
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macos'
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return 'windows'
}

export function isAppleSilicon() {
  const p = (navigator.platform || '') + ' ' + ((navigator.userAgentData && navigator.userAgentData.platform) || '')
  return /arm|aarch64/i.test(navigator.platform || '') || /ARM/.test(p)
}

export function primaryDownloadUrl(ua) {
  const os = detectOS(ua)
  if (os === 'macos') {
    return isAppleSilicon() ? DOWNLOAD_URLS.macos.arm64 : DOWNLOAD_URLS.macos.x64
  }
  if (os === 'linux') return DOWNLOAD_URLS.linux.appimage
  return DOWNLOAD_URLS.windows.setup
}

export function initDownloadButton() {
  const btn = document.getElementById('download-primary')
  const label = document.getElementById('download-label')
  if (!btn || !label) return
  const url = primaryDownloadUrl(navigator.userAgent)
  btn.href = url
  const os = detectOS(navigator.userAgent)
  label.textContent =
    os === 'macos' ? 'Download for Mac' : os === 'linux' ? 'Download for Linux' : 'Download for Windows'
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initDownloadButton)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Create site/style.css**

```css
:root {
  --violet: #7c3aed;
  --violet-light: #8b5cf6;
  --bg: #050508;
  --surface: #111118;
  --border: rgba(255, 255, 255, 0.08);
  --text: #f4f4f5;
  --text-dim: rgba(255, 255, 255, 0.5);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  line-height: 1.6;
}

.container { max-width: 1000px; margin: 0 auto; padding: 0 24px; }

/* Hero */
.hero {
  padding: 96px 0 72px;
  text-align: center;
  background:
    radial-gradient(600px 300px at 50% 0%, rgba(124, 58, 237, 0.18), transparent 70%),
    var(--bg);
}
.hero h1 { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 800; letter-spacing: -0.02em; }
.hero h1 span { color: var(--violet-light); }
.hero p.tagline { font-size: 1.15rem; color: var(--text-dim); max-width: 560px; margin: 16px auto 32px; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--violet); color: #fff; text-decoration: none;
  padding: 14px 32px; border-radius: 14px; font-weight: 600; font-size: 1rem;
  transition: background 0.2s;
}
.btn-primary:hover { background: var(--violet-light); }
.alt-downloads { margin-top: 14px; font-size: 0.85rem; color: var(--text-dim); }
.alt-downloads a { color: var(--violet-light); text-decoration: none; margin: 0 6px; }
.alt-downloads a:hover { text-decoration: underline; }

/* Sections */
section { padding: 64px 0; border-top: 1px solid var(--border); }
section h2 { font-size: 1.6rem; margin-bottom: 8px; letter-spacing: -0.01em; }
section p.sub { color: var(--text-dim); margin-bottom: 32px; }

.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
.step { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
.step .num { color: var(--violet-light); font-weight: 700; font-size: 0.85rem; margin-bottom: 8px; }
.step h3 { font-size: 1.05rem; margin-bottom: 6px; }
.step p { font-size: 0.9rem; color: var(--text-dim); }

.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
.feature { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
.feature h3 { font-size: 1.05rem; margin-bottom: 6px; }
.feature p { font-size: 0.9rem; color: var(--text-dim); }

.hotkeys { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.hotkey { display: flex; justify-content: space-between; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; }
.hotkey span { font-size: 0.9rem; color: var(--text-dim); }
.hotkey code { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; background: rgba(124, 58, 237, 0.15); color: var(--violet-light); padding: 4px 10px; border-radius: 8px; white-space: nowrap; }

/* Install tabs */
.tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.tab { background: none; border: 1px solid var(--border); color: var(--text-dim); padding: 8px 18px; border-radius: 10px; cursor: pointer; font-size: 0.9rem; }
.tab.active { border-color: var(--violet); color: var(--violet-light); background: rgba(124, 58, 237, 0.1); }
.tab-panel { display: none; }
.tab-panel.active { display: block; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; font-size: 0.92rem; color: var(--text-dim); }
.tab-panel ol { padding-left: 20px; }
.tab-panel li { margin-bottom: 10px; }
.tab-panel img { max-width: 100%; border-radius: 8px; margin-top: 8px; }

/* FAQ */
.faq-item { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px 24px; margin-bottom: 12px; }
.faq-item h3 { font-size: 1rem; margin-bottom: 6px; }
.faq-item p { font-size: 0.9rem; color: var(--text-dim); }

footer { padding: 40px 0; border-top: 1px solid var(--border); color: var(--text-dim); font-size: 0.85rem; text-align: center; }
footer a { color: var(--violet-light); text-decoration: none; }

@media (max-width: 640px) {
  .hero { padding: 64px 0 48px; }
}
```

- [ ] **Step 7: Create site/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Specter AI — The AI copilot no one else can see</title>
  <meta name="description" content="Open-source, privacy-first AI screen & meeting copilot. Invisible overlay powered by OpenRouter. Bring your own API key." />
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <!-- Hero -->
  <div class="hero">
    <div class="container">
      <h1>The AI copilot<br /><span>no one else can see</span></h1>
      <p class="tagline">
        Specter AI reads your screen and meeting audio, then answers in an overlay
        invisible to screen sharing. Free, open source, privacy-first.
      </p>
      <a id="download-primary" class="btn-primary" href="https://github.com/umairinayat/Specter-AI/releases/latest/download/specter-setup.exe">
        <span id="download-label">Download for Windows</span>
      </a>
      <p class="alt-downloads">
        Also available:
        <a href="https://github.com/umairinayat/Specter-AI/releases/latest/download/specter-setup.exe">Windows</a> ·
        <a href="https://github.com/umairinayat/Specter-AI/releases/latest/download/specter-mac-arm64.zip">macOS</a> ·
        <a href="https://github.com/umairinayat/Specter-AI/releases/latest/download/specter-linux-x64.AppImage">Linux</a>
        · <a href="https://github.com/umairinayat/Specter-AI/releases">All releases</a>
      </p>
    </div>
  </div>

  <!-- How it works -->
  <section>
    <div class="container">
      <h2>How it works</h2>
      <p class="sub">From download to first answer in about two minutes.</p>
      <div class="steps">
        <div class="step">
          <div class="num">Step 1</div>
          <h3>Install &amp; connect</h3>
          <p>A 2-minute setup wizard connects your OpenRouter, OpenAI, or Codex plan key. It's stored encrypted on your machine.</p>
        </div>
        <div class="step">
          <div class="num">Step 2</div>
          <h3>Press a hotkey</h3>
          <p>Ctrl+Enter captures your screen, transcribes meeting audio, and sends both as context with your question.</p>
        </div>
        <div class="step">
          <div class="num">Step 3</div>
          <h3>Get answers only you see</h3>
          <p>Responses stream into a translucent overlay that Zoom, Meet, and Teams screen sharing cannot capture.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section>
    <div class="container">
      <h2>Features</h2>
      <p class="sub">Everything runs locally except the AI API call you trigger.</p>
      <div class="features">
        <div class="feature"><h3>Invisible overlay</h3><p>Always-on-top, transparent, excluded from screen capture on Windows and macOS.</p></div>
        <div class="feature"><h3>Screen reading</h3><p>On-demand OCR of your screen — text and optional vision screenshots for capable models.</p></div>
        <div class="feature"><h3>Live transcription</h3><p>Rolling meeting transcript via Whisper (Groq free tier, OpenAI, or custom endpoint).</p></div>
        <div class="feature"><h3>Any model</h3><p>500+ models on OpenRouter, or use your existing OpenAI / ChatGPT Codex plan.</p></div>
        <div class="feature"><h3>Playbooks</h3><p>Inject meeting prep, job descriptions, and notes into every prompt automatically.</p></div>
        <div class="feature"><h3>Auto-updates</h3><p>The app updates itself silently in the background. No re-downloads.</p></div>
      </div>
    </div>
  </section>

  <!-- Hotkeys -->
  <section>
    <div class="container">
      <h2>Hotkeys</h2>
      <p class="sub">All customizable in Settings.</p>
      <div class="hotkeys">
        <div class="hotkey"><span>Ask AI with screen context</span><code>Ctrl+Enter</code></div>
        <div class="hotkey"><span>Ask AI with screenshot</span><code>Ctrl+Shift+Enter</code></div>
        <div class="hotkey"><span>Show / hide overlay</span><code>Ctrl+\</code></div>
        <div class="hotkey"><span>Toggle audio transcription</span><code>Ctrl+Shift+Space</code></div>
      </div>
    </div>
  </section>

  <!-- Install help -->
  <section>
    <div class="container">
      <h2>Installation</h2>
      <p class="sub">Per-platform notes and trust prompts.</p>
      <div class="tabs">
        <button class="tab active" data-tab="win">Windows</button>
        <button class="tab" data-tab="mac">macOS</button>
        <button class="tab" data-tab="linux">Linux</button>
      </div>

      <div id="tab-win" class="tab-panel active">
        <ol>
          <li>Download <strong>specter-setup.exe</strong> and run it.</li>
          <li>If Windows SmartScreen shows "Windows protected your PC":
            click <strong>More info</strong> → <strong>Run anyway</strong>.
            <img src="./smartscreen.png" alt="SmartScreen More info → Run anyway walkthrough" />
            <em>(This prompt appears while builds are unsigned; it disappears once signed releases ship.)</em>
          </li>
          <li>Follow the setup wizard — that's it.</li>
        </ol>
      </div>

      <div id="tab-mac" class="tab-panel">
        <ol>
          <li>Download the <strong>specter-mac-arm64.zip</strong> (Apple Silicon) or <strong>specter-mac-x64.zip</strong> (Intel) and unzip it.</li>
          <li>Drag <strong>Specter AI</strong> to Applications.</li>
          <li>First launch: right-click the app → <strong>Open</strong> (bypasses Gatekeeper for unsigned builds).</li>
          <li>Grant Screen Recording and Microphone permissions when prompted (System Settings → Privacy &amp; Security).</li>
        </ol>
      </div>

      <div id="tab-linux" class="tab-panel">
        <ol>
          <li>Download <strong>specter-linux-x64.AppImage</strong>, make it executable (<code>chmod +x</code>), and run it.</li>
          <li>Or install <strong>specter-linux-x64.deb</strong> with your package manager.</li>
          <li>X11 works best; screen-capture exclusion is limited on Wayland.</li>
        </ol>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section>
    <div class="container">
      <h2>FAQ</h2>
      <div class="faq-item">
        <h3>Is using Specter AI during meetings or exams allowed?</h3>
        <p>That depends on the rules of your meeting, employer, school, or exam provider — many prohibit assistance tools. Specter AI is intended for legitimate use: accessibility, note-taking, translation, and remembering your own prep. You are responsible for following the rules that apply to you.</p>
      </div>
      <div class="faq-item">
        <h3>Where does my data go?</h3>
        <p>Everything stays on your machine except the AI API call you trigger, which sends extracted text (and optional screenshots) to your chosen provider with your own key. No telemetry, no analytics, no servers of ours.</p>
      </div>
      <div class="faq-item">
        <h3>Is it really free?</h3>
        <p>The app is free and open source (MIT). You bring your own AI access: OpenRouter has free models, Groq transcription has a free tier, and Codex-plan users need no API key at all.</p>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <p><a href="https://github.com/umairinayat/Specter-AI">GitHub</a> · MIT License · Built with Electron, React, and TypeScript</p>
    </div>
  </footer>

  <script type="module" src="./script.js"></script>
  <script>
    // Install-tab switching (inline; no dependencies)
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active') })
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active') })
        tab.classList.add('active')
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
      })
    })
  </script>
</body>
</html>
```

Note: `./smartscreen.png` is referenced by the Windows install tab. Create a placeholder now and replace later:
1. Take the screenshot (or temporarily use any explanatory image), save as `site/smartscreen.png`
2. If no image is available yet, remove the `<img ...>` line and add it back when the screenshot exists — never ship a broken image reference.

- [ ] **Step 8: Create the Pages deploy workflow**

Create `.github/workflows/site.yml`:

```yaml
name: Deploy site

on:
  push:
    branches: [main]
    paths: ['site/**']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 9: Local verification**

```bash
cd site && python -m http.server 8080
```

Open `http://localhost:8080` in a browser:
1. Primary button label matches your OS; href points at the right artifact
2. Tab switching works
3. All asset links resolve (right-click → copy link → open; Windows/Linux URLs 404 until the next tagged release ships with the new artifact names — that's expected pre-release)

Then enable Pages (one-time, manual): GitHub repo → Settings → Pages → Source: **GitHub Actions**. Custom domain: add a `CNAME` file in `site/` with the domain (e.g. `specterai.app`) and configure DNS per GitHub's docs.

- [ ] **Step 10: Commit**

```bash
git add package.json site .github/workflows/site.yml tests/site-detect-os.test.ts
git commit -m "feat(site): download website with OS detection and Pages deploy"
```

---

### Task 14: Windows signing wiring in CI

**Files:**
- Modify: `.github/workflows/build.yml:26-55` (build-windows job)

- [ ] **Step 1: Add conditional cert decode + signing env**

Replace the `Build Windows portable` step (and its env) in the `build-windows` job with:

```yaml
      - name: Decode signing certificate
        id: cert
        shell: pwsh
        run: |
          if ("${{ secrets.WINDOWS_CSC_LINK }}" -ne "") {
            [IO.File]::WriteAllBytes("cert.pfx", [Convert]::FromBase64String("${{ secrets.WINDOWS_CSC_LINK }}"))
            "available=true" >> $env:GITHUB_OUTPUT
            Write-Host "Signing certificate decoded"
          } else {
            "available=false" >> $env:GITHUB_OUTPUT
            Write-Host "No signing certificate configured — building unsigned"
          }

      - name: Build Windows installer
        run: npx electron-builder --win --publish never ${{ steps.cert.outputs.available == 'true' && '--config.win.signAndEditExecutable=true' || '' }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ steps.cert.outputs.available == 'true' && 'cert.pfx' || '' }}
          CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CSC_KEY_PASSWORD }}
```

How it works: `package.json` keeps `win.signAndEditExecutable: false` (safe default — signing config without a cert would fail builds). When the `WINDOWS_CSC_LINK` secret (base64 .pfx) exists, CI decodes it to `cert.pfx`, passes `CSC_LINK`/`CSC_KEY_PASSWORD`, and flips `signAndEditExecutable` on for the build. Empty-string env vars are treated as unset by electron-builder, so the unsigned path is unchanged.

- [ ] **Step 2: Verify the workflow is valid YAML**

```bash
npx --yes js-yaml .github/workflows/build.yml > /dev/null && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: conditional Windows code-signing via secrets"
```

---

### Task 15: Version bump, CHANGELOG, final verification

**Files:**
- Modify: `package.json:3` (version)
- Modify: `src/shared/constants.ts:5` (APP_VERSION)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version to 1.4.0**

`package.json`: `"version": "1.4.0",`
`src/shared/constants.ts`: `export const APP_VERSION = '1.4.0'`

- [ ] **Step 2: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` (follow the file's existing entry format if one is established; otherwise):

```markdown
## [1.4.0] — 2026-08-26

### Added
- First-run setup wizard: provider selection (OpenRouter / OpenAI / Codex plan), API key
  validation with auto-detection, model picker, live end-to-end test, hotkey walkthrough.
  Skippable via "Skip" — re-runnable from the tray menu.
- Auto-update: silent background checks against GitHub Releases with a restart toast.
- Download website (GitHub Pages): OS auto-detect download button, install walkthroughs, FAQ.
- Windows CI code-signing support via `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD` secrets.
- Stable, version-less release artifact names (`specter-setup.exe`, `specter-mac-arm64.zip`, …)
  for permanent download links.
- Vitest test infrastructure.
```

- [ ] **Step 3: Full verification**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all exit 0

- [ ] **Step 4: Commit**

```bash
git add package.json src/shared/constants.ts CHANGELOG.md
git commit -m "chore: bump version to 1.4.0 with distribution polish changelog"
```

- [ ] **Step 5: Manual release checklist (for the human, after merge)**

1. Tag and push: `git tag v1.4.0 && git push origin v1.4.0` — CI builds and publishes the release with the new stable artifact names
2. Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and add the custom domain
3. Verify the site's download links resolve against the v1.4.0 release
4. Start the certificate purchase (SSL.com / Certum OSS / SignPath) — when the cert arrives, add the two secrets and CI signs automatically
5. Install v1.4.0 once, then tag a `v1.4.1` test release later to observe the update toast round-trip

---

## Self-Review Results

- **Spec coverage:** Onboarding (Tasks 2–10), auto-update (Tasks 11–12), website + stable URLs (Task 13), signing CI + cert guidance (Task 14 + release checklist), sequencing honored. Spec's "external day-1 action" (cert purchase) lands in the final checklist since it's a human action, not code.
- **Placeholders:** None — every step carries complete code or an exact command. The one external asset (`smartscreen.png`) has explicit handling instructions.
- **Type consistency:** `ProviderId` exported from onboarding `App.tsx` and imported by steps; `detectApiKeyType` returns `'openrouter' | 'openai' | 'unknown'` and is only compared against the first two; IPC channel names (`ONBOARDING_COMPLETE`, `ONBOARDING_CHECK_CODEX`, `UPDATE_STATUS`, `APP_INSTALL_UPDATE`) match between `ipc-channels.ts`, preload, and consumers; preload `onUpdateStatus`/`installUpdate` signatures match `UpdateToast` usage.
