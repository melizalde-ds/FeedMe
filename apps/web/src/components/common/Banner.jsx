import { TextButton } from '../ui/Button'
import { cx } from '../ui/cx'
import { Alert, Check } from '../ui/icons'

const LOOKS = {
  notice: { box: 'bg-raise', icon: 'text-ok', Icon: Check },
  warning: { box: 'bg-warn-tint', icon: 'text-ink', Icon: Alert },
  error: { box: 'bg-danger-tint ring-1 ring-danger ring-inset', icon: 'text-danger', Icon: Alert },
}

// A message about something that happened: a change, a warning, a failure.
// Each kind has its own icon and its title in words, so none of them depends
// on its tint. `compact` is for one inside a panel or a dialog.
export function Banner({ variant = 'notice', title, children, onDismiss, compact = false, className }) {
  const { box, icon, Icon } = LOOKS[variant] ?? LOOKS.notice

  return (
    <div
      className={cx(
        'flex items-start gap-3 rounded-tile text-base text-ink',
        compact ? 'px-3.5 py-2.5' : 'px-4 py-3',
        box,
        className,
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <Icon className={cx('mt-1 shrink-0', icon)} />
      <div className="min-w-0 flex-1">
        {title ? <strong className="font-bold">{title}. </strong> : null}
        {children}
      </div>
      {onDismiss ? (
        <TextButton className="shrink-0" onClick={onDismiss}>
          Dismiss
        </TextButton>
      ) : null}
    </div>
  )
}
