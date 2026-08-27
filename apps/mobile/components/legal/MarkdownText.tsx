import { Fragment, type ReactNode } from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

// Rendu markdown minimal et volontairement sans dépendance (app RN/Expo gelée pour la QA).
// Couvre ce dont le contenu légal provisoire a besoin : titres #/##/###, listes "- ",
// gras **inline**, italique _inline_ complet de ligne, paragraphes séparés par ligne vide.
// Quand le contenu définitif arrivera (GYM-109), ce renderer pourra être remplacé par une
// lib dédiée sans toucher aux écrans (le markdown reste une simple prop).

export function MarkdownText({ markdown }: { markdown: string }) {
  const { tokens } = useTheme()

  // ⚠️ `renderInline` VIT DÉSORMAIS DANS LE COMPOSANT, et ce n'est pas un détail de style.
  // Hors de lui, elle ne pouvait pas lire le thème ; lui passer l'encre en paramètre
  // déplaçait la couleur de sa déclaration vers ses DEUX appels — la suite des couleurs
  // du fichier changeait de longueur et d'ordre, et `verify-screen-parity` signalait
  // quatre écarts sur une migration pourtant exacte. La refermer sur `tokens` la laisse
  // exactement là où elle était.
  const renderInline = (text: string, keyBase: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <Text key={`${keyBase}-b${i}`} className="font-dmsans-bold" style={{ color: tokens.onSurface }}>
            {part.slice(2, -2)}
          </Text>
        )
      }
      return <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>
    })

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
        className={`mb-3 font-dmsans text-[13px] leading-6 ${italic ? 'italic' : ''}`}
        style={{ color: italic ? tokens.onBackgroundMuted : tokens.onSurfaceSecondary }}
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
        <Text key={key} className="mb-1.5 mt-3 font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
          {line.slice(4)}
        </Text>,
      )
    } else if (line.startsWith('## ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <Text key={key} className="mb-2 mt-4 font-dmsans-bold text-base" style={{ color: tokens.onSurface }}>
          {line.slice(3)}
        </Text>,
      )
    } else if (line.startsWith('# ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <Text key={key} className="mb-3" style={{ color: tokens.onSurface, fontFamily: 'BarlowCondensed_900Black', fontSize: 22, letterSpacing: 1 }}>
          {line.slice(2)}
        </Text>,
      )
    } else if (line.startsWith('- ')) {
      flushParagraph(`p${idx}`)
      blocks.push(
        <View key={key} className="mb-1.5 flex-row pr-2">
          <Text className="font-dmsans text-[13px] leading-6" style={{ color: tokens.onSurfaceSecondary }}>•  </Text>
          <Text className="flex-1 font-dmsans text-[13px] leading-6" style={{ color: tokens.onSurfaceSecondary }}>
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
