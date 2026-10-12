import { Link } from 'react-router'
import { Wordmark } from '../common/AppHeader'
import { ThemeToggle } from '../common/ThemeToggle'

const STEPS = [
  ['Setup', 'Your household’s allergies first, then diet, tastes, goals and budget.'],
  ['Plan', 'A week of breakfasts, lunches and dinners, each checked against your allergies and diet.'],
  ['Grocery', 'The list from the week you confirm, and an agent that shops for it.'],
]

// The frame around the sign-in pages. A newcomer lands here, so this is where
// the app says what it does; the form sits beside it.
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-8">
        <Link to="/" aria-label="FeedMe home" className="rounded-chip">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>

      <main
        id="main"
        className="mx-auto grid w-full max-w-[1100px] flex-1 content-start gap-x-16 gap-y-10 px-4 py-10 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-center md:content-center md:py-16"
      >
        <div className="max-md:order-2">
          <p className="max-w-[18ch] text-4xl font-extrabold tracking-tight text-balance max-md:text-2xl">
            A week of meals your whole household can eat.
          </p>
          <ol className="mt-8 max-w-[44ch] border-t border-line">
            {STEPS.map(([name, line]) => (
              <li key={name} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-line py-3.5">
                <span className="font-bold">{name}</span>
                <span className="text-mute">{line}</span>
              </li>
            ))}
          </ol>
        </div>

        {children}
      </main>
    </div>
  )
}
