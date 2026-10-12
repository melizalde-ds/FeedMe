import { buttonClass } from './buttonClass'
import { cx } from './cx'

// Every button in the app. `type` defaults to "button" so one inside a form
// never submits it by accident.
export function Button({ variant, size, className, type = 'button', ...rest }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...rest} />
}

// A square button that holds one icon. It needs an aria-label.
export function IconButton({ className, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-raise text-ink transition-colors hover:border-ink pointer-coarse:size-11',
        className,
      )}
      {...rest}
    />
  )
}

export const linkClass =
  'font-semibold text-ink underline decoration-mark decoration-2 underline-offset-4 hover:decoration-ink'

// An action that reads as a link: "Dismiss", "Edit setup", "Ask me first".
export function TextButton({ className, type = 'button', ...rest }) {
  return <button type={type} className={cx(linkClass, 'text-left', className)} {...rest} />
}
