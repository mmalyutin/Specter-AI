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
