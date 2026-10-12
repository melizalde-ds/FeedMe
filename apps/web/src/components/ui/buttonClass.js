import { cx } from './cx'

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border font-semibold whitespace-nowrap transition-[border-color,background-color,color,scale] active:not-disabled:scale-[0.97] disabled:cursor-not-allowed'

const VARIANTS = {
  default:
    'border-line bg-raise text-ink hover:not-disabled:border-ink disabled:text-mute aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ground',
  primary:
    'border-accent bg-accent text-on-accent hover:not-disabled:border-ink disabled:border-line disabled:bg-raise disabled:text-mute',
  quiet: 'border-transparent bg-transparent text-ink hover:not-disabled:bg-raise disabled:text-mute',
  danger:
    'border-danger-fill bg-danger-fill text-on-danger-fill hover:not-disabled:border-ink disabled:border-line disabled:bg-raise disabled:text-mute',
}

const SIZES = {
  sm: 'min-h-8 px-3 text-ui pointer-coarse:min-h-10',
  md: 'min-h-10 px-4 text-base pointer-coarse:min-h-11',
  lg: 'min-h-12 px-6 text-lg',
}

export const buttonClass = ({ variant = 'default', size = 'md', className } = {}) =>
  cx(BASE, VARIANTS[variant], SIZES[size], className)
