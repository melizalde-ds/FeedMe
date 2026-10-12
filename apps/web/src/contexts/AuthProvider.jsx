import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { authConfigured } from '../lib/config'
import { AUTH_NOT_CONFIGURED, authErrorMessage } from '../lib/authErrors'
import { setUnauthorizedHandler } from '../lib/http'
import { supabase } from '../lib/supabase'
import { AuthContext } from './contexts'

// Email and password only. Supabase holds the session in local storage and
// refreshes it; this provider mirrors it into React and owns sign-out.
export function AuthProvider({ children }) {
  const navigate = useNavigate()
  // undefined while the stored session is being read, then a session or null.
  const [session, setSession] = useState(supabase ? undefined : null)

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  // A 401 from the API means the token is no longer accepted: drop the
  // session in this browser and send the user to sign in again. Several
  // requests can fail at once, so only the first one acts. The session is
  // gone before the redirect, or the sign-in page would see a signed-in user
  // and send them straight back. The message is also kept here, because the
  // app's own redirect to /login can win the race and carries no message.
  const [sessionNotice, setSessionNotice] = useState(null)
  const ending = useRef(false)

  useEffect(() => {
    setUnauthorizedHandler(async (message) => {
      if (ending.current) return
      ending.current = true
      setSessionNotice(message)
      try {
        await supabase?.auth.signOut({ scope: 'local' })
      } finally {
        navigate('/login', { replace: true, state: { message } })
        ending.current = false
      }
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  const signIn = useCallback(async ({ email, password }) => {
    if (!supabase) return { error: AUTH_NOT_CONFIGURED }
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) return { error: authErrorMessage(error) }
      setSessionNotice(null)
      return {}
    } catch (error) {
      return { error: authErrorMessage(error) }
    }
  }, [])

  const signUp = useCallback(async ({ email, password }) => {
    if (!supabase) return { error: AUTH_NOT_CONFIGURED }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (error) return { error: authErrorMessage(error) }

      // With email confirmation on, GoTrue answers an existing address with a
      // user that has no identities instead of an error.
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
        return { error: authErrorMessage({ code: 'user_already_exists' }) }
      }

      return data.session ? {} : { needsConfirmation: true }
    } catch (error) {
      return { error: authErrorMessage(error) }
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    try {
      await supabase.auth.signOut()
    } catch {
      // The server may be unreachable; the local session is cleared anyway.
      await supabase.auth.signOut({ scope: 'local' })
    }
  }, [])

  const value = useMemo(
    () => ({
      configured: authConfigured,
      loading: session === undefined,
      session: session ?? null,
      user: session?.user ?? null,
      // Why the last session ended, until the user signs in again.
      sessionNotice,
      signIn,
      signUp,
      signOut,
    }),
    [session, sessionNotice, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
