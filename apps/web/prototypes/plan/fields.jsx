// The two form controls every direction uses, unstyled: each direction
// passes its own class names.
import { PREFS } from './model.js'

// The native dropdown the app uses today, with its Recipes and Leftovers groups.
export function MealSelect({ m, day, slotIndex, label, className, id }) {
  const { options, leftovers, value } = m.optionsFor(day, slotIndex)
  return (
    <select
      id={id}
      className={className}
      aria-label={label}
      value={value}
      data-empty={value === '' ? '' : undefined}
      onChange={(event) => m.setSlot(day, slotIndex, event.target.value)}
    >
      <option value="">Choose a meal</option>
      <optgroup label="Recipes">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
      {leftovers.length ? (
        <optgroup label="Leftovers">
          {leftovers.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  )
}

export function PeopleInput({ m, detail, id, className }) {
  return (
    <input
      id={id}
      className={className}
      type="number"
      min="1"
      inputMode="numeric"
      placeholder={PREFS.householdSize}
      value={detail.slot.servings ?? ''}
      onChange={(event) => m.setServings(detail.day, detail.slotIndex, event.target.value)}
    />
  )
}
