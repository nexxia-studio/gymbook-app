import { Fragment, type ReactNode } from 'react'
import { View, Text } from 'react-native'

// Rendu markdown minimal et volontairement sans dépendance (app RN/Expo gelée pour la QA).
// Couvre ce dont le contenu légal provisoire a besoin : titres #/##/###, listes "- ",
// gras **inline**, italique _inline_ complet de ligne, paragraphes séparés par ligne vide.
// Quand le contenu définitif arrivera (GYM-109), ce renderer pourra être remplacé par une
// lib dédiée sans toucher aux écrans (le markdown reste une simple prop).

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={`${keyBase}-b${i}`} className="font-dmsans-bold text-move-dark">
          {part.slice(2, -2)}
        </Text>
      )
    }
    return <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>
  })
}

export function MarkdownText({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    const italic = text.startsWith('_') && text.endsWith('_')
    blocks.push(
      <Text
        key={key}
        className={`mb-3 font-dmsans text-[13px] leading-6 ${italic ? 'italic text-move-text-muted' : 'text-move-text-secondary'}`}
      >
        {italic ? text.slice(1, -1) : renderInline(text, key)}
      </Text>,
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
        <Text key={key} className="mb-1.5 mt-3 font-dmsans-bold text-sm text-move-dark">
          {line.slice(4)}
        </Text>,
      )
    } else if (line.startsWith('## ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <Text key={key} className="mb-2 mt-4 font-dmsans-bold text-base text-move-dark">
          {line.slice(3)}
        </Text>,
      )
    } else if (line.startsWith('# ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <Text key={key} className="mb-3 text-move-dark" style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, letterSpacing: 1 }}>
          {line.slice(2)}
        </Text>,
      )
    } else if (line.startsWith('- ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <View key={key} className="mb-1.5 flex-row pr-2">
          <Text className="font-dmsans text-[13px] leading-6 text-move-text-secondary">•  </Text>
          <Text className="flex-1 font-dmsans text-[13px] leading-6 text-move-text-secondary">
            {renderInline(line.slice(2), key)}
          </Text>
        </View>,
      )
    } else {
      paragraph.push(line)
    }
  })
  flushParagraph('p-final')

  return <View>{blocks}</View>
}
