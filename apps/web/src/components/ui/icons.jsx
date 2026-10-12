// One icon set for all three directions: 24px grid, 2px round strokes.
const Svg = ({ size = 16, children, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
)

export const Check = (props) => <Svg {...props}><path d="M4 12.5l5 5L20 6.5" /></Svg>
export const Alert = (props) => (
  <Svg {...props}><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5M12 17.2v.3" /></Svg>
)
export const Close = (props) => <Svg {...props}><path d="M6 6l12 12M18 6 6 18" /></Svg>
export const Clock = (props) => (
  <Svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
)
export const Plus = (props) => <Svg {...props}><path d="M12 5v14M5 12h14" /></Svg>
export const Swap = (props) => (
  <Svg {...props}><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></Svg>
)
export const Undo = (props) => (
  <Svg {...props}><path d="M8 5 4 9l4 4" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>
)
export const Arrow = (props) => <Svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
export const Chevron = (props) => <Svg {...props}><path d="M6 9l6 6 6-6" /></Svg>
export const Star = (props) => (
  <Svg {...props}><path d="m12 4 2.5 5.2 5.7.8-4.1 4 1 5.6L12 17l-5.1 2.6 1-5.6-4.1-4 5.7-.8L12 4Z" /></Svg>
)
export const Sun = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Svg>
)
export const Moon = (props) => <Svg {...props}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Svg>
export const Auto = (props) => (
  <Svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" /></Svg>
)

export const ThemeIcon = ({ choice, ...props }) =>
  choice === 'light' ? <Sun {...props} /> : choice === 'dark' ? <Moon {...props} /> : <Auto {...props} />
export const Lock = (props) => (
  <Svg {...props}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Svg>
)
export const Cart = (props) => (
  <Svg {...props}><path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7" /><circle cx="9.5" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></Svg>
)
export const Trash = (props) => (
  <Svg {...props}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" /></Svg>
)
export const Pencil = (props) => (
  <Svg {...props}><path d="m4 20 1-4.5L16.5 4l3.5 3.5L8.5 19 4 20Z" /><path d="m14 6.5 3.5 3.5" /></Svg>
)
