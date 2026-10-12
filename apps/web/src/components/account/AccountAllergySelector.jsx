import { useState } from 'react'
import { TERM_RULES, normalizeTerm, termProblem } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { Button } from '../ui/Button'
import { Chip, Choice, FieldError, Hint, Label, inputClass } from '../ui/Field'
import { Alert, Lock } from '../ui/icons'

// Requirement 4.1, for a signed-in user: allergies come first and apply to
// the whole household. The options come from GET /api/allergens. Allergies on
// the account can't be removed (the database refuses), so a saved one is
// locked; a tick that hasn't been saved yet can still be undone.
export function AccountAllergySelector() {
  const { preferences, updatePreferences } = useHousehold()
  const { allergenOptions, saved, allergiesKnown } = useAccountSetup()
  const [custom, setCustom] = useState('')
  const [error, setError] = useState(null)

  const allergenIds = preferences.allergenIds ?? []
  const customAllergies = preferences.customAllergies ?? []

  const toggle = (id) =>
    updatePreferences((current) => {
      const ids = current.allergenIds ?? []
      return {
        allergenIds: ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
      }
    })

  const addCustom = () => {
    const term = normalizeTerm(custom)
    if (!term) return
    const problem =
      termProblem(term) ??
      (customAllergies.includes(term) ? 'That allergen is already on the list.' : null)
    if (problem) {
      setError(problem)
      return
    }
    updatePreferences((current) => ({
      customAllergies: [...(current.customAllergies ?? []), term],
    }))
    setCustom('')
    setError(null)
  }

  const removeCustom = (name) =>
    updatePreferences((current) => ({
      customAllergies: (current.customAllergies ?? []).filter((item) => item !== name),
    }))

  const labelFor = (id) => allergenOptions.find((option) => option.id === id)?.label ?? id
  const avoided = [...allergenIds.map(labelFor), ...customAllergies]
  const unsaved =
    allergenIds.some((id) => !saved.allergenIds.includes(id)) ||
    customAllergies.some((name) => !saved.customAllergies.includes(name))

  // The one block on the page with a heavy outline and a warning mark: it is
  // the safety input, and it must not look like the fields around it.
  return (
    <fieldset className="min-w-0 rounded-panel border-2 border-ink bg-raise p-5 sm:p-6">
      <legend className="float-left mb-2 flex w-full items-center gap-2 text-xl font-bold tracking-tight">
        <Alert size={20} />
        Allergies
      </legend>

      <div className="clear-both max-w-[58ch]">
        <p>Allergies apply to everyone in the household. Every meal we plan avoids all of them.</p>
        <p className="mt-2 flex gap-2 font-semibold">
          <Lock className="mt-1 shrink-0" />
          <span>
            Allergies saved to your account can be added, but not removed. Check each one before
            you save. Ticks you haven&rsquo;t saved yet can still be undone.
          </span>
        </p>
        {!allergiesKnown ? <Hint>Loading the allergies already on your account…</Hint> : null}
      </div>

      <div className="mt-5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {allergenOptions.map((option) => {
          const locked = saved.allergenIds.includes(option.id)
          return (
            <Choice
              key={option.id}
              type="checkbox"
              checked={allergenIds.includes(option.id) || locked}
              disabled={locked}
              onChange={() => toggle(option.id)}
            >
              {option.label}
              {locked ? <span className="text-sm"> (saved, can&rsquo;t be removed)</span> : null}
            </Choice>
          )
        })}
      </div>

      <div className="mt-6 max-w-xl">
        <Label htmlFor="custom-allergen">Another allergen</Label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="custom-allergen"
            type="text"
            className={inputClass}
            placeholder="e.g. mustard"
            value={custom}
            aria-invalid={Boolean(error)}
            aria-describedby={`custom-allergen-hint${error ? ' custom-allergen-error' : ''}`}
            onChange={(event) => {
              setCustom(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addCustom()
              }
            }}
          />
          <Button onClick={addCustom}>Add</Button>
        </div>
        {error ? (
          <FieldError id="custom-allergen-error" role="alert">
            {error}
          </FieldError>
        ) : null}
        <Hint id="custom-allergen-hint">
          {TERM_RULES}. A common name such as &ldquo;dairy&rdquo; is saved as the matching
          allergen above.
        </Hint>
      </div>

      {customAllergies.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Other allergens">
          {customAllergies.map((name) =>
            saved.customAllergies.includes(name) ? (
              <li key={name}>
                <Chip>
                  <Lock size={12} />
                  {name}
                  <span className="text-mute">(saved)</span>
                </Chip>
              </li>
            ) : (
              <li key={name}>
                <Chip onRemove={() => removeCustom(name)} removeLabel={`Remove ${name}`}>
                  {name}
                </Chip>
              </li>
            ),
          )}
        </ul>
      ) : null}

      <p className="mt-5 border-t border-line pt-4 font-semibold" role="status">
        {avoided.length ? `Every meal avoids: ${avoided.join(', ')}.` : 'No allergies selected yet.'}
        {unsaved ? ' Some of these are not saved to your account yet.' : ''}
      </p>
    </fieldset>
  )
}
