// Supabase Auth errors in plain language. Matched on the error code first and
// the message second, because older GoTrue versions send no code.

export const MIN_PASSWORD_LENGTH = 6

export const AUTH_NOT_CONFIGURED =
  'Sign-in is not configured in this copy of FeedMe. Run scripts/gen-env.py at the repo root, then restart the web app.'

const MESSAGES = {
  invalid_credentials: 'That email and password don’t match an account. Check them and try again.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password: `That password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  email_address_invalid: 'That email address doesn’t look right. Check it and try again.',
  email_not_confirmed: 'Confirm your email first, using the link we sent you, then sign in.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  over_email_send_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  signup_disabled: 'New accounts are switched off right now.',
}

const UNREACHABLE =
  'We couldn’t reach the sign-in service. Check your connection and try again.'

export function authErrorMessage(error) {
  if (!error) return null
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]

  const message = String(error.message ?? '').toLowerCase()
  if (message.includes('invalid login credentials')) return MESSAGES.invalid_credentials
  if (message.includes('already registered') || message.includes('already exists')) {
    return MESSAGES.user_already_exists
  }
  if (message.includes('password') && (message.includes('at least') || message.includes('short'))) {
    return MESSAGES.weak_password
  }
  if (message.includes('email not confirmed')) return MESSAGES.email_not_confirmed
  if (
    error.name === 'AuthRetryableFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('network')
  ) {
    return UNREACHABLE
  }
  return 'Something went wrong with sign-in. Try again in a moment.'
}

export function emailProblem(email) {
  const value = String(email ?? '').trim()
  if (!value) return 'Enter your email address.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Enter an email address like name@example.com.'
  }
  return null
}

export function passwordProblem(password, { checkLength = true } = {}) {
  if (!password) return 'Enter your password.'
  if (checkLength && password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}
