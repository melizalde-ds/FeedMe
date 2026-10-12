import { useEffect } from 'react'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { IconButton } from '../ui/Button'
import { ThemeIcon } from '../ui/icons'

const STORAGE_KEY = 'feedme.theme'
const ORDER = ['system', 'light', 'dark']

const LABELS = {
  system: 'following your system',
  light: 'light',
  dark: 'dark',
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
    <IconButton
      onClick={() => setTheme(next)}
      title={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
    >
      <ThemeIcon choice={theme} />
    </IconButton>
  )
}
