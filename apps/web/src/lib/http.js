import { apiUrl } from './config.js'
import { supabase } from './supabase.js'

const DEFAULT_TIMEOUT_MS = 20_000

export const SESSION_ENDED_MESSAGE =
  'Your session has ended. Sign in again to keep using your account.'

const failure = (message, kind, status = 0) => {
  const error = new Error(message)
  error.kind = kind
  error.status = status
  return error
}

// 'unavailable' means the service could not be reached, or the route is not
// there, so trying again later may work. 'invalid' means it answered and
// refused, or answered with something we refuse to show (requirement 7.2).
// `status` is the HTTP status, 0 if none.
export const unavailable = (message, status = 0) =>
  failure(message, 'unavailable', status)
export const invalid = (message, status = 0) => failure(message, 'invalid', status)

// Set by the AuthProvider, which can sign out and navigate. Kept here so this
// module does not depend on React or the router.
let onUnauthorized = null
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

async function accessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// FastAPI puts a readable message in `detail`. Validation errors carry a list
// there instead, which is not fit to show.
const detailOf = (payload) =>
  typeof payload?.detail === 'string' ? payload.detail : null

// The one fetch helper for the backend. `path` comes from `endpoints` in
// config.js. A signed-in user's access token is sent as a bearer token.
export async function apiFetch(
  path,
  { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const token = await accessToken()
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw unavailable('The FeedMe server could not be reached.')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.ok) return payload
  throw refusal(response.status, payload, token)
}

// The error for an answer that is not a success.
function refusal(status, payload, token) {
  const detail = detailOf(payload)

  if (status === 401) {
    if (token) onUnauthorized?.(SESSION_ENDED_MESSAGE)
    return invalid(SESSION_ENDED_MESSAGE, 401)
  }

  // A route from the contract answering 404 is not deployed yet.
  if (status === 404 || status >= 500) {
    return unavailable(
      detail ?? `The FeedMe server could not answer (${status}).`,
      status,
    )
  }

  return invalid(detail ?? `The request was refused (${status}).`, status)
}

// One server-sent event: "event: <type>" and "data: <json>" lines. Lines
// starting with ":" are keepalives.
function parseEvent(block) {
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) data += line.slice(5).trimStart()
  }
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

// POSTs `body` and reads the answer as a stream of server-sent events, calling
// `onEvent` with each one's JSON. The browser's EventSource can't do this: it
// can neither POST nor send the bearer token. Resolves when the stream ends.
// There is no timeout: a shopping run can wait ten minutes for a payment to
// be approved. `signal` stops the reading, not the run on the server.
export async function apiStream(path, { body, onEvent, signal } = {}) {
  const token = await accessToken()
  const headers = { Accept: 'text/event-stream', 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw unavailable('The FeedMe server could not be reached.')
  }

  if (!response.ok) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw refusal(response.status, payload, token)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const event = parseEvent(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (event) onEvent?.(event)
        end = buffer.indexOf('\n\n')
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw unavailable('The connection to the FeedMe server was lost.')
  }
}
