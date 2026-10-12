import { useState } from 'react'
import { MAX_TERMS, TERM_RULES, normalizeTerm, termProblem } from '../../lib/accountSetup'
import { ui } from '../ui/styles'

// A list of short terms, such as liked foods, typed one at a time. Each term
// is checked against the database's rules before it is added.
export function TermListField({
  id,
  label,
  hint,
  values,
  onChange,
  otherValues = [],
  otherLabel = '',
  placeholder,
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)

  const add = () => {
    const term = normalizeTerm(draft)
    if (!term) return

    const problem =
      termProblem(term) ??
      (values.includes(term) ? 'That one is already on the list.' : null) ??
      (otherValues.includes(term) ? `That one is already in ${otherLabel}.` : null) ??
      (values.length >= MAX_TERMS ? `Keep it to ${MAX_TERMS} or fewer.` : null)

    if (problem) {
      setError(problem)
      return
    }

    onChange([...values, term])
    setDraft('')
    setError(null)
  }

  return (
    <div className="mt-4">
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          type="text"
          className={`${ui.input} mt-0`}
          placeholder={placeholder}
          value={draft}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className={ui.button} onClick={add}>
          Add
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <p id={`${id}-hint`} className={ui.hint}>
        {hint} One food per entry: {TERM_RULES}.
      </p>

      {values.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0" aria-label={label}>
          {values.map((term) => (
            <li key={term}>
              <button
                type="button"
                className={`${ui.chip} cursor-pointer hover:bg-panel`}
                onClick={() => onChange(values.filter((item) => item !== term))}
              >
                {term}
                <span aria-hidden="true">×</span>
                <span className="sr-only">Remove {term}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
