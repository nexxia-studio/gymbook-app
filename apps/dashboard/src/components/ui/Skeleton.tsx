interface SkeletonProps {
  className?: string
  variant?: 'text' | 'card' | 'avatar' | 'kpi' | 'table-row'
}

const variantClasses = {
  text: 'h-4 w-3/4 rounded',
  card: 'h-32 w-full rounded-2xl',
  avatar: 'h-10 w-10 rounded-full',
  kpi: 'h-28 w-full rounded-2xl',
  'table-row': 'h-14 w-full rounded-xl',
}

export function Skeleton({ className = '', variant = 'text' }: SkeletonProps) {
  return (
    <div
      className={`animate-skeleton bg-dark/10 ${variantClasses[variant]} ${className}`}
    />
  )
}
