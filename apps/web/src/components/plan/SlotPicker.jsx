import {
  decodeSlotValue,
  encodeSlotValue,
  slotOptions,
} from '../../lib/planner'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { Hint, Label, inputClass } from '../ui/Field'

// The two controls that change one meal: which recipe it is, and how many
// people it is cooked for. They sit in the recipe shelf, one meal at a time.
export function SlotPicker({ week, day, slotIndex }) {
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

  return (
    <div>
      <div className="grid max-w-xl grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div>
          <Label htmlFor="slot-meal" className="mb-1.5">
            {slot.recipe ? 'Change this meal' : 'Meal'}
          </Label>
          <select
            id="slot-meal"
            className={inputClass}
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
        </div>

        <div>
          <Label htmlFor="slot-people" className="mb-1.5">
            People
          </Label>
          <input
            id="slot-people"
            className={inputClass}
            type="number"
            min="1"
            inputMode="numeric"
            placeholder={preferences.householdSize}
            aria-describedby="slot-people-hint"
            value={slot.servings ?? ''}
            onChange={(event) =>
              setSlotServings(week, day, slotIndex, event.target.value)
            }
          />
        </div>
      </div>
      <Hint id="slot-people-hint">
        Leave People blank to cook for your household of {preferences.householdSize}.
      </Hint>
    </div>
  )
}
