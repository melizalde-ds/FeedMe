import { cx } from '../ui/cx'
import { AccountMenu } from './AccountMenu'
import { ThemeToggle } from './ThemeToggle'

const STEPS = [
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan' },
  { id: 'grocery', label: 'Grocery' },
]

// The name, set in the app's own type.
export function Wordmark({ className }) {
  return <span className={cx('text-2xl leading-none font-black tracking-tighter', className)}>FeedMe</span>
}

// The bar every signed-in screen sits under: the name, the three steps, the
// account and the theme. On a phone the steps drop to a row of their own.
export function AppHeader({ view, onNavigate, groceryReady }) {
  return (
    <header className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-b border-line px-4 py-3 sm:px-8">
      <p>
        <Wordmark />
      </p>

      <nav className="flex gap-1 max-md:order-3 max-md:basis-full" aria-label="Main">
        {STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            className="flex items-baseline gap-2 rounded-control px-3.5 py-2 text-base font-semibold text-mute transition-colors hover:text-ink aria-[current=page]:bg-raise aria-[current=page]:text-ink aria-[current=page]:shadow-[inset_0_-3px_0_var(--mark)] max-md:flex-1 max-md:flex-col max-md:gap-0"
            aria-current={view === step.id ? 'page' : undefined}
            onClick={() => onNavigate(step.id)}
          >
            {step.label}
            {step.id === 'grocery' && !groceryReady ? (
              <span className="text-xs font-normal">confirm a week first</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        <AccountMenu />
        <ThemeToggle />
      </div>
    </header>
  )
}
