import { useState } from 'react'
import { Link } from 'react-router'
import {
  AUTH_NOT_CONFIGURED,
  MIN_PASSWORD_LENGTH,
  emailProblem,
  passwordProblem,
} from '../../lib/authErrors'
import { useAuth } from '../../hooks/useAuth'
import { Banner } from '../common/Banner'
import { Button, linkClass } from '../ui/Button'
import { FieldError, Hint, Label, inputClass } from '../ui/Field'

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
    <section className="w-full" aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-3xl font-extrabold tracking-tight">
        {title}
      </h1>
      <p className="mt-2 text-mute">
        {registering
          ? 'FeedMe plans meals around your household’s allergies, diet and budget. Create an account to start.'
          : 'Sign in to plan your household’s meals.'}
      </p>

      {notice ? (
        <Banner compact className="mt-5">
          {notice}
        </Banner>
      ) : null}

      {!configured ? (
        <Banner variant="error" compact className="mt-5">
          {AUTH_NOT_CONFIGURED}
        </Banner>
      ) : null}

      <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <div>
          <Label htmlFor="auth-email">Email</Label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            className={`${inputClass} mt-1.5`}
            value={values.email}
            onChange={change('email')}
            onBlur={blur('email')}
            aria-invalid={Boolean(shown('email'))}
            aria-describedby={shown('email') ? 'auth-email-error' : undefined}
            disabled={!configured || pending}
          />
          {shown('email') ? <FieldError id="auth-email-error">{shown('email')}</FieldError> : null}
        </div>

        <div>
          <Label htmlFor="auth-password">Password</Label>
          <input
            id="auth-password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            className={`${inputClass} mt-1.5`}
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
            <FieldError id="auth-password-error">{shown('password')}</FieldError>
          ) : registering ? (
            <Hint id="auth-password-hint">At least {MIN_PASSWORD_LENGTH} characters.</Hint>
          ) : null}
        </div>

        {error ? (
          <Banner variant="error" compact>
            {error}
          </Banner>
        ) : null}

        <Button type="submit" variant="primary" size="lg" disabled={!configured || pending}>
          {pending
            ? registering
              ? 'Creating your account…'
              : 'Signing in…'
            : registering
              ? 'Create account'
              : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6">
        {registering ? 'Already have an account? ' : 'New to FeedMe? '}
        <Link to={registering ? '/login' : '/register'} className={linkClass}>
          {registering ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </section>
  )
}
