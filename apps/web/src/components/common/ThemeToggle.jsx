import { useEffect } from 'react'
import { useLocalStorage } from '../../hooks/useLocalStorage'

const STORAGE_KEY = 'feedme.theme'
const ORDER = ['system', 'light', 'dark']

const LABELS = {
  system: 'following your system',
  light: 'light',
  dark: 'dark',
}

const Icon = ({ theme }) => {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3.25" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13" />
        </g>
      </svg>
    )
  }

  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M13.5 9.8A6 6 0 0 1 6.2 2.5a6 6 0 1 0 7.3 7.3Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
    </svg>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useLocalStorage(STORAGE_KEY, 'system')

  // The stylesheet keys off data-theme on the document, which is outside
  // React's tree, so it has to be written here.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
    >
      <Icon theme={theme} />
    </button>
  )
}
