import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'

// The header's account corner: who is signed in, and "Sign out".
export function AccountMenu() {
  const { user, signOut } = useAuth()

  if (!user) return null

  return (
    <>
      <span className="truncate text-sm text-mute max-md:hidden" title={user.email}>
        {user.email}
      </span>
      <Button size="sm" onClick={signOut}>
        Sign out
      </Button>
    </>
  )
}
