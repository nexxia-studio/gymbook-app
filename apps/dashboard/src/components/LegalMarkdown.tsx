import { Fragment, type ReactNode } from 'react'

// Rendu markdown minimal, sans dépendance — parité avec le renderer mobile
// (components/legal/MarkdownText.tsx). Couvre exactement ce dont les textes légaux ont
// besoin : titres #/##/###, listes « - », gras **inline**, paragraphes séparés par ligne
// vide. Pas de tableaux (les sources n'en contiennent aucun après conversion en listes).

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-dark">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>
  })
}

export function LegalMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    blocks.push(
      <p key={key} className="mb-3 text-sm leading-6 text-secondary">
        {renderInline(text, key)}
      </p>,
    )
    paragraph = []
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    const key = `l${idx}`
    if (line === '') {
      flushParagraph(`p${idx}`)
    } else if (line.startsWith('### ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <h3 key={key} className="mb-1.5 mt-6 font-body text-sm font-bold text-dark">
          {line.slice(4)}
        </h3>,
      )
    } else if (line.startsWith('## ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <h2 key={key} className="mb-2 mt-7 font-body text-base font-bold text-dark">
          {line.slice(3)}
        </h2>,
      )
    } else if (line.startsWith('# ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <h1 key={key} className="mb-4 font-display text-3xl font-black uppercase tracking-tight text-dark">
          {line.slice(2)}
        </h1>,
      )
    } else if (line.startsWith('- ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <div key={key} className="mb-1.5 flex gap-2 pr-2">
          <span className="text-sm leading-6 text-secondary">•</span>
          <span className="flex-1 text-sm leading-6 text-secondary">{renderInline(line.slice(2), key)}</span>
        </div>,
      )
    } else {
      paragraph.push(line)
    }
  })
  flushParagraph('p-final')

  return <div>{blocks}</div>
}
