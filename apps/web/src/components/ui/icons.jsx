// The app's icons, all from Phosphor at its bold weight, which holds up at
// the 13 to 20px they are used at. Each is imported on its own, so only the
// ones named here are bundled. They are decoration beside a word, so every one
// is hidden from assistive technology.
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Check as PhCheck } from '@phosphor-icons/react/dist/csr/Check'
import { CircleHalf } from '@phosphor-icons/react/dist/csr/CircleHalf'
import { Lock as PhLock } from '@phosphor-icons/react/dist/csr/Lock'
import { Moon } from '@phosphor-icons/react/dist/csr/Moon'
import { Plus as PhPlus } from '@phosphor-icons/react/dist/csr/Plus'
import { ShoppingCart } from '@phosphor-icons/react/dist/csr/ShoppingCart'
import { Star as PhStar } from '@phosphor-icons/react/dist/csr/Star'
import { Sun } from '@phosphor-icons/react/dist/csr/Sun'
import { Trash as PhTrash } from '@phosphor-icons/react/dist/csr/Trash'
import { Warning } from '@phosphor-icons/react/dist/csr/Warning'
import { X } from '@phosphor-icons/react/dist/csr/X'

// What every icon is given: Phosphor's bold weight, and hidden from
// assistive technology.
const SHARED = { weight: 'bold', 'aria-hidden': 'true', focusable: 'false' }

export function Check({ size = 16, ...rest }) {
  return <PhCheck size={size} {...SHARED} {...rest} />
}

export function Alert({ size = 16, ...rest }) {
  return <Warning size={size} {...SHARED} {...rest} />
}

export function Close({ size = 16, ...rest }) {
  return <X size={size} {...SHARED} {...rest} />
}

export function Plus({ size = 16, ...rest }) {
  return <PhPlus size={size} {...SHARED} {...rest} />
}

export function Undo({ size = 16, ...rest }) {
  return <ArrowCounterClockwise size={size} {...SHARED} {...rest} />
}

export function Arrow({ size = 16, ...rest }) {
  return <ArrowRight size={size} {...SHARED} {...rest} />
}

export function Star({ size = 16, ...rest }) {
  return <PhStar size={size} {...SHARED} {...rest} />
}

export function Lock({ size = 16, ...rest }) {
  return <PhLock size={size} {...SHARED} {...rest} />
}

export function Cart({ size = 16, ...rest }) {
  return <ShoppingCart size={size} {...SHARED} {...rest} />
}

export function Trash({ size = 16, ...rest }) {
  return <PhTrash size={size} {...SHARED} {...rest} />
}

const THEME_GLYPHS = { light: Sun, dark: Moon, system: CircleHalf }

export function ThemeIcon({ choice, size = 16, ...rest }) {
  const Glyph = THEME_GLYPHS[choice] ?? CircleHalf
  return <Glyph size={size} {...SHARED} {...rest} />
}

// The one drawn mark that is not Phosphor's: the tick that draws itself when
// a week is confirmed. Phosphor's glyphs are filled outlines, and a stroke is
// what can be drawn along its length.
export function DrawnTick({ size = 20, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  )
}
