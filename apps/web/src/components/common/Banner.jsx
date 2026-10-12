export function Banner({ variant = 'notice', title, children, onDismiss }) {
  return (
    <div
      className={`banner banner--${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <div className="banner__body">
        {title ? <strong className="banner__title">{title}</strong> : null}
        <div>{children}</div>
      </div>
      {onDismiss ? (
        <button type="button" className="banner__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
