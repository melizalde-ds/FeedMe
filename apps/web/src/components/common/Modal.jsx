import { useEffect, useRef } from 'react'
import { IconButton } from '../ui/Button'
import { cx } from '../ui/cx'
import { Close } from '../ui/icons'

// For the few tasks that need the whole screen's attention: writing a recipe,
// confirming a shopping run. A native <dialog>, so the browser keeps focus
// inside it and makes the page behind it inert. Escape and a click on the
// backdrop both close it.
export function Modal({ title, onClose, children, size = 'wide' }) {
  const dialog = useRef(null)

  useEffect(() => {
    const el = dialog.current
    // The dialog leaves the page when it closes, so the browser can't hand
    // focus back by itself.
    const opener = document.activeElement
    if (!el.open) el.showModal()
    return () => {
      el.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className={cx(
        'sheet m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-panel border border-line bg-raise text-ink shadow-overlay',
        size === 'narrow' ? 'max-w-lg' : 'max-w-3xl',
      )}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // The dialog's own box is filled by the panel below, so a click that
        // lands on the dialog itself is a click on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-2xl font-extrabold tracking-tight text-balance">{title}</h2>
          <IconButton onClick={onClose} aria-label="Close">
            <Close />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  )
}
