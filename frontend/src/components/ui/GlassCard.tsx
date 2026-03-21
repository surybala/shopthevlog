import { type ReactNode, forwardRef } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className = '', onClick, hoverable = false, padding = 'md' }, ref) => {
    const base = hoverable ? 'glass-hover' : 'glass'
    return (
      <div
        ref={ref}
        onClick={onClick}
        className={`${base} ${paddingMap[padding]} ${className}`}
      >
        {children}
      </div>
    )
  }
)
GlassCard.displayName = 'GlassCard'

export default GlassCard
