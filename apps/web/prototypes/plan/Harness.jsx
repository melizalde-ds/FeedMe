import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './picker.css'
import { Label } from './Label.jsx'
import { Market } from './Market.jsx'
import { Wall } from './Wall.jsx'

const VARIANTS = [
  { name: 'Label', Component: Label },
  { name: 'Market', Component: Market },
  { name: 'Wall', Component: Wall },
]

const fromUrl = () => {
  const index = (parseInt(new URLSearchParams(window.location.search).get('v'), 10) || 1) - 1
  return index >= 0 && index < VARIANTS.length ? index : 0
}

// The picker's markup, keys and URL behaviour follow the prototype skill's
// PICKER.md. Switching re-mounts the direction; nothing animates the swap.
export function Harness() {
  const [current, setCurrent] = useState(fromUrl)
  const [mount, setMount] = useState(0)
  const [ready, setReady] = useState(false)
  const items = useRef([])
  const highlight = useRef(null)

  const moveHighlight = useCallback(() => {
    const el = items.current[current]
    if (!el || !highlight.current) return
    highlight.current.style.width = `${el.offsetWidth}px`
    highlight.current.style.transform = `translateX(${el.offsetLeft}px)`
  }, [current])

  const activate = useCallback((index) => {
    if (index < 0 || index >= VARIANTS.length) return
    setCurrent(index)
    setMount((value) => value + 1)
    const url = new URL(window.location.href)
    url.searchParams.set('v', index + 1)
    window.history.replaceState(null, '', url)
    window.scrollTo(0, 0)
  }, [])

  useLayoutEffect(moveHighlight, [moveHighlight])

  useEffect(() => {
    window.addEventListener('resize', moveHighlight)
    document.fonts?.ready.then(moveHighlight)
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
    return () => {
      window.removeEventListener('resize', moveHighlight)
      cancelAnimationFrame(frame)
    }
  }, [moveHighlight])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = parseInt(event.key, 10)
      if (number >= 1 && number <= VARIANTS.length) activate(number - 1)
      else if (event.key === 'ArrowRight') activate((current + 1) % VARIANTS.length)
      else if (event.key === 'ArrowLeft') activate((current - 1 + VARIANTS.length) % VARIANTS.length)
      else if (event.key === 'r' || event.key === 'R') setMount((value) => value + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activate, current])

  const { Component } = VARIANTS[current]

  return (
    <>
      <Component key={`${current}-${mount}`} />
      <nav className="proto-picker" aria-label="Prototype variants" data-ready={ready ? '' : undefined}>
        <span className="proto-picker-highlight" aria-hidden="true" ref={highlight} />
        {VARIANTS.map((variant, index) => (
          <button
            key={variant.name}
            type="button"
            className="proto-picker-item"
            data-active={index === current ? '' : undefined}
            aria-current={index === current ? 'true' : undefined}
            ref={(el) => {
              items.current[index] = el
            }}
            onClick={() => activate(index)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true" />
        <button
          type="button"
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setMount((value) => value + 1)}
        >
          ↻
        </button>
      </nav>
    </>
  )
}
