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
  const platform = navigator.platform || ''
  return /arm|aarch64/i.test(platform)
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
  const ua = navigator.userAgent
  btn.href = primaryDownloadUrl(ua)
  const os = detectOS(ua)
  label.textContent =
    os === 'macos' ? 'Download for Mac' : os === 'linux' ? 'Download for Linux' : 'Download for Windows'
}

if (typeof document !== 'undefined' && typeof navigator !== 'undefined') {
  const ready = document.readyState === 'loading'
  if (ready) {
    document.addEventListener('DOMContentLoaded', initDownloadButton)
  } else {
    initDownloadButton()
  }
}
