import { useAuth } from '../../hooks/useAuth'

// The header's account corner: who is signed in, and "Sign out".
export function AccountMenu() {
  const { user, signOut } = useAuth()

  if (!user) return null

  return (
    <div className="flex min-w-0 items-center gap-3 text-green-ink">
      <span className="truncate text-sm" title={user.email}>
        {user.email}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-lg border border-green-ink bg-transparent px-3 py-1 font-semibold text-green-ink hover:opacity-90"
        onClick={signOut}
      >
        Sign out
      </button>
    </div>
  )
}
