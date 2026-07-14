import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react'
import { useToastStore, type ToastVariant } from '@/hooks/useToast'

const variantConfig: Record<ToastVariant, { bg: string; icon: typeof CheckCircle }> = {
  success: { bg: 'bg-[#4827B4] text-[#C8FF3D]', icon: CheckCircle },
  error: { bg: 'bg-red-600 text-white', icon: XCircle },
  warning: { bg: 'bg-amber-500 text-white', icon: AlertTriangle },
}

function ToastItem({ id, message, variant }: { id: string; message: string; variant: ToastVariant }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const { bg, icon: Icon } = variantConfig[variant]
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => setVisible(false), 2700)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg transition-all duration-300 ${bg} ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1 font-body text-sm font-medium">{message}</span>
      <button onClick={() => removeToast(id)} className="shrink-0 opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>
  )
}
