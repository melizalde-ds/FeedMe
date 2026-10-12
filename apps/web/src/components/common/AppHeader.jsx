import logo from '../../assets/text-logo.png'
import { AccountMenu } from './AccountMenu'
import { ThemeToggle } from './ThemeToggle'

const STEPS = [
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan' },
  { id: 'grocery', label: 'Grocery' },
]

export function AppHeader({ view, onNavigate, groceryReady }) {
  return (
    <header className="app-header">
      <p className="app-header__brand">
        <img className="app-header__mark" src={logo} alt="" width="40" height="40" />
      </p>

      <nav className="app-nav" aria-label="Main">
        {STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`app-nav__tab${view === step.id ? ' is-current' : ''}`}
            aria-current={view === step.id ? 'page' : undefined}
            onClick={() => onNavigate(step.id)}
          >
            {step.label}
            {step.id === 'grocery' && !groceryReady ? (
              <span className="app-nav__hint">confirm a week first</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <AccountMenu />
        <ThemeToggle />
      </div>
    </header>
  )
}
