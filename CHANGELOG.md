# Changelog

All notable changes to Specter AI are documented in this file.

## [1.3.0] - 2026-08-23

### Added
- Send live screenshots to vision-capable OpenRouter models instead of relying only on OCR text
- Windows NSIS installer and portable `.exe` artifacts with distinct filenames
- Overlay error when screen capture fails, instead of silently sending empty context

### Changed
- Screen capture now uses Electron `desktopCapturer` first so packaged Windows builds work without external screenshot binaries
- OCR is best-effort: a Tesseract failure no longer drops the screenshot
- Native modules (`koffi`, `tesseract.js`, `screenshot-desktop`) are unpacked from the asar archive

### Fixed
- Packaged `.exe` builds failing to take screenshots
- Send doing nothing when a screenshot was attached with no typed question
- Active-window crop depending on the `sharp` devDependency, which is missing in production
