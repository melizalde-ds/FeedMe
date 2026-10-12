import { useEffect, useRef, useState } from 'react'

// `initialValue` may be a function, which is only called when there is nothing
// stored yet. That keeps an expensive default from being rebuilt every render.
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) return JSON.parse(stored)
    } catch {
      // Fall through to the default below.
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue
  })

  const keyRef = useRef(key)

  useEffect(() => {
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(value))
    } catch {
      // Storage may be unavailable (private browsing, quota). The app still
      // works, it just will not survive a refresh.
    }
  }, [value])

  return [value, setValue]
}
