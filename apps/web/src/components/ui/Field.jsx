import { cx } from './cx'
import { Close } from './icons'

// One look for every text box, number box, dropdown and text area. The border
// is the strong hairline, so the control's edge passes 3:1 in both themes.
export const inputClass =
  'block w-full min-h-10.5 rounded-control border border-line-strong bg-field px-3 py-1.5 text-base text-ink transition-colors hover:not-disabled:border-ink aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11'

export const labelClass = 'block text-ui font-semibold text-ink'

export function Label({ className, ...rest }) {
  return <label className={cx(labelClass, className)} {...rest} />
}

export function Hint({ className, ...rest }) {
  return <p className={cx('mt-1.5 text-sm text-mute', className)} {...rest} />
}

export function FieldError({ className, ...rest }) {
  return <p className={cx('mt-1.5 text-sm font-semibold text-danger', className)} {...rest} />
}

// A tick box or radio button with its label, as one target.
export function Choice({ className, children, ...input }) {
  return (
    <label className={cx('flex items-start gap-2.5 text-base has-disabled:text-mute pointer-coarse:py-1.5', className)}>
      <input className="mt-0.75 size-4.5 shrink-0 accent-mark" {...input} />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

// A short term on a list: a saved one is fixed, an unsaved one is a button
// that removes it.
export function Chip({ children, onRemove, removeLabel, className }) {
  const base =
    'inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-flag border border-line bg-raise px-2.5 text-ui wrap-anywhere text-ink pointer-coarse:min-h-10'

  if (!onRemove) return <span className={cx(base, className)}>{children}</span>

  return (
    <button
      type="button"
      className={cx(base, 'transition-[border-color,scale] hover:border-ink active:scale-[0.97]', className)}
      onClick={onRemove}
    >
      {children}
      <Close size={12} />
      <span className="sr-only">{removeLabel}</span>
    </button>
  )
}
