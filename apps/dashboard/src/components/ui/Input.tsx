import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helper?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, className = '', id, ...props }, ref) => {
    const inputId = id ?? props.name

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="font-body text-sm font-medium text-dark">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`rounded-xl border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors placeholder:text-dark/30 ${
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-[#E8E6E0] focus:border-dark'
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && helper && <p className="text-xs text-dark/40">{helper}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
