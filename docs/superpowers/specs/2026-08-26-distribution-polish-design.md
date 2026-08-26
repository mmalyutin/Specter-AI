# Specter AI — Distribution & Product Polish Design

**Date:** 2026-08-26
**Status:** Approved
**Scope:** Turn Specter AI from "a project that builds installers" into "a product anyone can download, set up, trust, and keep updated."

---

## Context

Specter AI v1.3.0 already builds NSIS/portable Windows installers, macOS dmg/zip, and Linux AppImage/deb via electron-builder, with a GitHub Actions release workflow. What is missing for a mainstream user:

1. No first-run guidance — users land on a floating overlay with no API key, no explanation.
2. No auto-update — users are stuck on the version they downloaded.
3. No download destination — releases are buried on GitHub; `docs/` holds an unlinked landing page.
4. No code signing — Windows SmartScreen and macOS Gatekeeper block/scarify unsigned installers.

**Budget:** whatever the product needs (signing certs, domain).
**Primary user:** mainstream first, with a fast lane for technical users.
**Platform priority:** Windows first; macOS phase 2; Linux supported but not the focus.

## Sequencing (Approach 1: ship-value-first, cert in parallel)

1. **Week 1:** First-run onboarding wizard (biggest UX win, pure code)
2. **Week 2:** Auto-update via electron-updater + GitHub Releases
3. **Week 3:** Download website on custom domain + GitHub Pages
4. **Whenever cert arrives:** Wire signing into CI; ship signed release

Each workstream ships as its own release. Once auto-update ships (week 2), existing users receive subsequent improvements automatically.

**Day-1 parallel action:** Start code signing certificate purchase/validation (takes days–weeks; see Section 4).

---

## Section 1: First-Run Onboarding Wizard

### Goal

A brand-new user goes from "installed" to "first successful AI response" without reading the README. Technical users can skip everything in one click.

### Settings

- New setting `onboardingComplete: boolean` (default `false`), stored via existing `electron-store` (`store.ts`), with validator added to `SETTINGS_KEY_VALIDATORS`.
- On app start (`src/main/index.ts`): if `onboardingComplete` is false → open the onboarding window instead of dropping the user onto the overlay. The overlay is still created (hotkeys/tray work) but stays hidden until onboarding finishes.

### Window

- New module `src/main/onboarding-window.ts`.
- Normal framed, centered BrowserWindow, ~680×560, non-resizable, no `alwaysOnTop`, no transparency. Standard dashboard-style window (mirrors `dashboard-window.ts` patterns: security handlers, dev/prod URL loading).
- Loads new renderer entry `src/renderer/onboarding/` (`index.html`, `main.tsx`, `App.tsx`, per-step components).
- Reuses the existing preload bridge (`src/preload/index.ts`) — no second preload.

### IPC additions (`src/shared/ipc-channels.ts`)

- `onboarding:complete` — renderer → main; sets `onboardingComplete: true`, closes wizard, shows overlay.
- `onboarding:check-codex` — `ipcMain.handle`; runs `codex --version` (spawn with timeout, `windowsHide`) and returns `{ installed: boolean, loggedInHint: boolean }`. `loggedInHint` is best-effort (presence of `~/.codex/auth.json`); the definitive check happens at first query.
- Provider selection, key entry, model choice, and the test query reuse existing channels: `settings:set`, `models:fetch`, `ai:query`, `ai:stream-chunk`, `ai:stream-done`, `ai:stream-error`.

### Wizard steps (`src/renderer/onboarding/App.tsx`)

1. **Welcome**
   - 3-line pitch + product visual + existing violet brand styling.
   - Buttons: `Get started` and `Skip — I'll set up later` (fast lane).
   - Skip = close wizard, show overlay, `onboardingComplete` stays `false` so "Run setup wizard" remains available in the tray menu (new tray item) and dashboard.

2. **Choose provider**
   - Three cards: **OpenRouter** (recommended; free models available), **OpenAI**, **Codex** (uses your ChatGPT plan login).

3. **Connect** (provider-specific panel)
   - **OpenRouter / OpenAI:** "Get your key" button opens the provider's key page in the external browser (existing `openExternal` path). Paste field with **auto-detection**: `sk-or-...` → OpenRouter; `sk-proj-...` / `sk-...` → OpenAI. If the pasted key type doesn't match the selected card, switch cards automatically and show a one-line note. Validate instantly:
     - OpenRouter: fetch `/models` with the key (existing `fetchAvailableModels`).
     - OpenAI: minimal models-list call.
   - **Codex:** calls `onboarding:check-codex`. If not installed → inline install + `codex login` instructions. If installed → confirm and continue.
   - **Optional sub-step:** "Enable live transcription" — Groq free key (console.groq.com), clearly marked optional with a Skip control. Saves `whisperApiKey` + `whisperProvider: 'groq'`.

4. **Pick a model**
   - 3 curated choices per provider: Fast / Balanced / Free (OpenRouter), plus a link to the full model browser (existing dashboard Models page). Saves `selectedModel` / `openaiModel` / `codexModel`.

5. **Test it**
   - One click sends a tiny query ("Say: ready"). User sees the streamed response — proves the full pipeline works before leaving the wizard.
   - Uses the normal AI stream IPC; render a compact streaming text box; inline retry on error.

6. **Done**
   - Shows the 4 default hotkeys + "right-click the tray icon" tip.
   - `Finish` → `onboarding:complete` → wizard closes, overlay appears.

### Error handling

- Every step has inline error display and retry. Invalid key never blocks exit — Skip remains available in the wizard header at all times.
- Codex detection failures degrade to instructions, never a dead end.

---

## Section 2: Auto-Update

### Mechanism

- `electron-updater` (official companion to electron-builder). Reads `latest.yml` that the existing CI already publishes to GitHub Releases. No backend, no additional hosting.
- The existing `publish: { provider: 'github', owner, repo }` config in `package.json` is exactly what electron-updater needs.

### Behavior

- New module `src/main/updater.ts`, initialized in `src/main/index.ts` after app ready:
  - `autoUpdater.checkForUpdates()` 10s after start, then every 6 hours.
  - Updates download silently in the background.
- When an update is downloaded, the overlay receives a `update:status` IPC event and shows a subtle toast: "v1.5.0 ready — Restart to update" with `Restart` / `Later`.
  - `Restart` → new IPC channel `app:install-update` → `autoUpdater.quitAndInstall()`.
  - `Later` → dismiss; toast does not re-appear this session (next reminder on next launch).
- Checks never interrupt an active AI stream or recording; install only happens on explicit user action.

### Config details

- Add `electron-updater` to `dependencies`.
- Windows: set `disableDifferentialDownload: true` (avoids delta-patch issues while unsigned).
- Update checks and downloads are skipped in dev (`is.dev`).
- Failure to reach GitHub or download errors are logged silently and retried on the next scheduled check. The app never nags and never blocks usage on updates.

### CI

- No changes required — `build.yml` already uploads release artifacts including `latest.yml`.

---

## Section 3: Download Website

### Hosting

- Custom domain (to be purchased, e.g. `specterai.app`) → GitHub Pages.
- Site lives in a new `/site` directory (the current `docs/` landing page is replaced by this work; `docs/superpowers/` specs are unaffected).
- GitHub Actions workflow `site.yml` deploys `/site` to Pages on push to `main`; custom domain configured in repo Settings → Pages.

### Content & structure

- Static HTML/CSS/JS only, no framework, matching existing brand (violet `#7C3AED`, glass morphism).
- **Hero:** tagline + primary download button that auto-detects the visitor's OS via `navigator.userAgent` and links to the latest release asset; secondary per-OS links (Windows / macOS / Linux).
- Download URLs use `https://github.com/umairinayat/Specter-AI/releases/latest/download/<artifact>` so they never go stale.
- **Sections:** how it works (3 steps with screenshots/GIFs), feature grid, hotkey cheat-sheet, FAQ (including an honest "meeting/exam policy" disclaimer), GitHub link, MIT license note.
- **Install help:** tabbed per OS; Windows tab includes the SmartScreen "More info → Run anyway" walkthrough for the unsigned period (to be removed once signed builds ship).
- A small `site/download-info.json` fetched at runtime could be added later for release notes; out of scope for v1 of the site.

---

## Section 4: Code Signing (Windows first) + Release

### Certificate (start immediately — parallel track)

- **Recommended budget route:** SSL.com or Certum "Open Source" (~$70–270/yr) OV certificate — individual developers qualify. Expect days–2 weeks for identity verification.
- EV (~$300+/yr) grants instant SmartScreen reputation; OV builds reputation over download volume. Start OV, upgrade if warnings remain a conversion problem.
- Alternative for OSS: SignPath.io free tier for open-source projects.

### CI wiring (`build.yml`)

- Add repository secrets: `WINDOWS_CSC_LINK` (base64-encoded cert), `WINDOWS_CSC_KEY_PASSWORD`.
- electron-builder signs automatically when these env vars are present. Flip `win.signAndEditExecutable` from `false` back to `true` once the cert exists (currently disabled because there is no cert — signing config without a cert fails builds).
- Signing applies to both NSIS and portable targets; both get published as before.

### macOS (phase 2 — not in this implementation pass)

- Apple Developer Program ($99/yr) → Developer ID Application certificate + `notarytool` notarization via an `afterSign` hook (e.g. `electron-notarize`).
- Entitlements plist already exists (`build-resources/entitlements.mac.plist`).

### Acceptance

- Signed Windows installer passes SmartScreen without "unknown publisher" warning (may require reputation ramp on OV).
- `signtool verify` / `codesign --verify` pass on artifacts in CI.

---

## Testing

- **Onboarding:** manual pass on a fresh profile (delete `specter-settings.json`) for all three providers, skip path, invalid-key path, Codex-not-installed path.
- **Auto-update:** publish a test release on a fork/`beta` channel tag; verify check → download → toast → quit-and-install round-trip on Windows.
- **Website:** `python -m http.server` local check for OS detection logic and asset links (assert links resolve against an existing release).
- **Signing:** verify signature on built artifacts before publishing the signed release; keep unsigned CI path working while secrets are absent.

## Out of scope (explicit)

- macOS notarization implementation (phase 2).
- Free-trial AI credits / proxy backend.
- Beta update channels UI.
- Linux signing (AppImage remains unsigned).
