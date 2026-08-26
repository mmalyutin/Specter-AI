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
