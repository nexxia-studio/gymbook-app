import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'

interface PlaceholderPageProps {
  pageKey: string
}

export default function PlaceholderPage({ pageKey }: PlaceholderPageProps) {
  const { t } = useTranslation()

  return (
    <DashboardLayout>
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            <Wrench className="h-8 w-8 text-accent-dim" />
          </div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark">
            {t('placeholder.title', { page: t(`nav.${pageKey}`) })}
          </h1>
          <p className="mt-2 font-body text-sm text-muted">
            {t('placeholder.subtitle')}
          </p>
          <div className="mx-auto mt-6 h-1 w-16 rounded-full bg-accent" />
        </div>
      </div>
    </DashboardLayout>
  )
}
