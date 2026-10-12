import { useState } from 'react'
import { Link } from 'react-router'
import {
  AUTH_NOT_CONFIGURED,
  MIN_PASSWORD_LENGTH,
  emailProblem,
  passwordProblem,
} from '../../lib/authErrors'
import { useAuth } from '../../hooks/useAuth'
import { ui } from '../ui/styles'

// The sign-in and register forms share everything but their words.
// `onSubmit` resolves to { error } or anything else on success.
export function AuthForm({ mode, onSubmit, notice }) {
  const { configured } = useAuth()
  const registering = mode === 'register'

  const [values, setValues] = useState({ email: '', password: '' })
  const [touched, setTouched] = useState({ email: false, password: false })
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const problems = {
    email: emailProblem(values.email),
    // Only a new password has to meet the length rule. An existing one is
    // checked by the server, so a short legacy password can still sign in.
    password: passwordProblem(values.password, { checkLength: registering }),
  }
  const shown = (field) => (touched[field] || submitted ? problems[field] : null)

  const change = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    setError(null)
  }
  const blur = (field) => () => setTouched((current) => ({ ...current, [field]: true }))

  const submit = async (event) => {
    event.preventDefault()
    setSubmitted(true)
    if (!configured || problems.email || problems.password) return

    setPending(true)
    setError(null)
    const result = await onSubmit(values)
    setPending(false)
    if (result?.error) setError(result.error)
  }

  const title = registering ? 'Create your account' : 'Sign in'

  return (
    <section className={`${ui.card} w-full max-w-md`} aria-labelledby="auth-title">
      <h1 id="auth-title" className="m-0 mb-2 font-prose text-3xl text-ink">
        {title}
      </h1>
      <p className="m-0 mb-6 text-mute">
        {registering
          ? 'FeedMe plans meals around your household’s allergies, diet and budget. Create an account to start.'
          : 'Sign in to plan your household’s meals.'}
      </p>

      {notice ? (
        <p className={`${ui.notice} mb-4`} role="status">
          {notice}
        </p>
      ) : null}

      {!configured ? (
        <p className={`${ui.alert} mb-4`} role="alert">
          {AUTH_NOT_CONFIGURED}
        </p>
      ) : null}

      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={ui.label} htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            className={ui.input}
            value={values.email}
            onChange={change('email')}
            onBlur={blur('email')}
            aria-invalid={Boolean(shown('email'))}
            aria-describedby={shown('email') ? 'auth-email-error' : undefined}
            disabled={!configured || pending}
          />
          {shown('email') ? (
            <p id="auth-email-error" className={ui.error}>
              {shown('email')}
            </p>
          ) : null}
        </div>

        <div>
          <label className={ui.label} htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            className={ui.input}
            value={values.password}
            onChange={change('password')}
            onBlur={blur('password')}
            aria-invalid={Boolean(shown('password'))}
            aria-describedby={
              shown('password')
                ? 'auth-password-error'
                : registering
                  ? 'auth-password-hint'
                  : undefined
            }
            disabled={!configured || pending}
          />
          {shown('password') ? (
            <p id="auth-password-error" className={ui.error}>
              {shown('password')}
            </p>
          ) : registering ? (
            <p id="auth-password-hint" className={ui.hint}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          ) : null}
        </div>

        {error ? (
          <p className={ui.alert} role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className={ui.buttonPrimary} disabled={!configured || pending}>
          {pending
            ? registering
              ? 'Creating your account…'
              : 'Signing in…'
            : registering
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      <p className="m-0 mt-6 text-ink">
        {registering ? 'Already have an account? ' : 'New to FeedMe? '}
        <Link to={registering ? '/login' : '/register'} className={ui.link}>
          {registering ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </section>
  )
}
