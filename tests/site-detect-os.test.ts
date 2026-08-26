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
