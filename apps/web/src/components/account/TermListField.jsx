import { useState } from 'react'
import { MAX_TERMS, TERM_RULES, normalizeTerm, termProblem } from '../../lib/accountSetup'
import { Button } from '../ui/Button'
import { Chip, FieldError, Hint, Label, inputClass } from '../ui/Field'

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
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <input
          id={id}
          type="text"
          className={inputClass}
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
        <Button onClick={add}>Add</Button>
      </div>
      {error ? (
        <FieldError id={`${id}-error`} role="alert">
          {error}
        </FieldError>
      ) : null}
      <Hint id={`${id}-hint`}>
        {hint} One food per entry: {TERM_RULES}.
      </Hint>

      {values.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label={label}>
          {values.map((term) => (
            <li key={term}>
              <Chip
                onRemove={() => onChange(values.filter((item) => item !== term))}
                removeLabel={`Remove ${term}`}
              >
                {term}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
