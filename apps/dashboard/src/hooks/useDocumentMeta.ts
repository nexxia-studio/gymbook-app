import { useEffect } from 'react'

// Pose <title> + <meta name="description"> pour les pages publiques (SEO / App Store review).
// Pas de react-helmet dans le projet ; on manipule le DOM directement et on restaure au démontage.
export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const created = !meta
    const prevDescription = meta?.getAttribute('content') ?? null
    if (description !== undefined) {
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute('name', 'description')
        document.head.appendChild(meta)
      }
      meta.setAttribute('content', description)
    }

    return () => {
      document.title = prevTitle
      if (description !== undefined && meta) {
        if (created) meta.remove()
        else if (prevDescription !== null) meta.setAttribute('content', prevDescription)
      }
    }
  }, [title, description])
}
