import { SLOT_LABELS, MEAL_SLOTS } from '../../lib/constants'
import {
  decodeSlotValue,
  encodeSlotValue,
  slotOptions,
} from '../../lib/planner'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'

export function SlotPicker({ week, day, slotIndex, onOpenRecipe }) {
  const { plan, setSlot, setSlotServings } = useMealPlan()
  const { preferences } = useHousehold()

  const slot = plan.weeks[week][day][slotIndex]
  const { options, leftovers } = slotOptions(plan, week, day, slotIndex, preferences)
  const value = encodeSlotValue(slot.recipe, slot.leftover)

  // A slot can hold a meal the dropdown no longer offers, such as leftovers
  // whose source meal was removed. Keep it listed so the value is never lost.
  const known = [...options, ...leftovers].some((option) => option.value === value)
  const orphan =
    slot.recipe && !known
      ? {
          value,
          label: slot.leftover ? `Leftovers: ${slot.recipe}` : slot.recipe,
        }
      : null

  const label = `${SLOT_LABELS[MEAL_SLOTS[slotIndex]]} on day ${day + 1}`

  return (
    <div className="slot">
      <select
        className={`slot__select${slot.recipe ? '' : ' is-empty'}`}
        aria-label={label}
        value={value}
        onChange={(event) =>
          setSlot(week, day, slotIndex, decodeSlotValue(event.target.value))
        }
      >
        <option value="">Choose a meal</option>
        {orphan ? <option value={orphan.value}>{orphan.label}</option> : null}
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

      <input
        className="slot__servings"
        type="number"
        min="1"
        inputMode="numeric"
        placeholder={preferences.householdSize}
        title="People for this meal. Leave blank to use your household size."
        aria-label={`People for ${label}`}
        value={slot.servings ?? ''}
        onChange={(event) =>
          setSlotServings(week, day, slotIndex, event.target.value)
        }
      />

      {slot.recipe ? (
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => onOpenRecipe({ week, day, slotIndex })}
        >
          Recipe
        </button>
      ) : null}
    </div>
  )
}
