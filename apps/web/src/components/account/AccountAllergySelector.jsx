import { useState } from 'react'
import { TERM_RULES, normalizeTerm, termProblem } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { ui } from '../ui/styles'

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

  return (
    <fieldset className="m-0 mb-6 rounded-xl border-2 border-risk-line bg-risk-bg p-4">
      <legend className="px-2 text-lg font-bold text-ink">Allergies</legend>

      <p className="m-0 text-ink">
        Allergies apply to everyone in the household. Every meal we plan avoids all of them.
      </p>
      <p className="m-0 mt-2 font-semibold text-ink">
        Allergies saved to your account can be added, but not removed. Check each one before
        you save. Ticks you haven&rsquo;t saved yet can still be undone.
      </p>
      {!allergiesKnown ? (
        <p className={ui.hint}>Loading the allergies already on your account…</p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {allergenOptions.map((option) => {
          const locked = saved.allergenIds.includes(option.id)
          return (
            <label key={option.id} className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                className="size-4 accent-green"
                checked={allergenIds.includes(option.id) || locked}
                disabled={locked}
                onChange={() => toggle(option.id)}
              />
              <span>
                {option.label}
                {locked ? <span className="text-sm text-mute"> (saved, can&rsquo;t be removed)</span> : null}
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4">
        <label className={ui.label} htmlFor="custom-allergen">
          Another allergen
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="custom-allergen"
            type="text"
            className={`${ui.input} mt-0`}
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
          <button type="button" className={ui.button} onClick={addCustom}>
            Add
          </button>
        </div>
        {error ? (
          <p id="custom-allergen-error" className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
        <p id="custom-allergen-hint" className={ui.hint}>
          {TERM_RULES}. A common name such as &ldquo;dairy&rdquo; is saved as the matching
          allergen above.
        </p>
      </div>

      {customAllergies.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0" aria-label="Other allergens">
          {customAllergies.map((name) =>
            saved.customAllergies.includes(name) ? (
              <li key={name} className={ui.chip}>
                {name}
                <span className="text-mute">(saved)</span>
              </li>
            ) : (
              <li key={name}>
                <button
                  type="button"
                  className={`${ui.chip} cursor-pointer hover:bg-panel`}
                  onClick={() => removeCustom(name)}
                >
                  {name}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove {name}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}

      <p className="m-0 mt-4 font-semibold text-ink" role="status">
        {avoided.length ? `Every meal avoids: ${avoided.join(', ')}.` : 'No allergies selected yet.'}
        {unsaved ? ' Some of these are not saved to your account yet.' : ''}
      </p>
    </fieldset>
  )
}
