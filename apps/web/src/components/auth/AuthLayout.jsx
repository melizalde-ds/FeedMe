import { Link } from 'react-router'
import logo from '../../assets/text-logo.png'
import { ThemeToggle } from '../common/ThemeToggle'

// The frame around the sign-in pages: the brand bar and a centred column.
export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex items-center gap-4 bg-green px-6 py-3 text-green-ink">
        <Link to="/" aria-label="FeedMe home" className="flex items-center">
          <img src={logo} alt="" width="150" height="40" className="h-10 w-[150px] object-contain" />
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex justify-center px-4 py-12">
        {children}
      </main>
    </div>
  )
}
