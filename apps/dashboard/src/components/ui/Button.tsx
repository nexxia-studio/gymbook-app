import { type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  isLoading?: boolean
}

// CTA Viniz : indigo + lime (lime en texte sur fond indigo = surface sombre, AA 8:1 OK).
// En mode sombre, remplissage lime + texte indigo-noir.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[#4827B4] text-[#C8FF3D] hover:opacity-90 dark:bg-[#C8FF3D] dark:text-[#17102E]',
  secondary: 'bg-card text-dark border border-border hover:bg-dark/5',
  ghost: 'bg-transparent text-dark/60 hover:text-dark hover:bg-dark/5',
}

export function Button({
  variant = 'primary',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-ui text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
