import {
  COOKING_TIME_OPTIONS,
  DIETARY_RESTRICTIONS,
  PLANNING_PERIOD_OPTIONS,
} from '../../lib/constants'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { AccountTastesFields } from '../account/AccountTastesFields'
import { NutritionGoalsFields } from '../account/NutritionGoalsFields'
import { Choice, FieldError, Hint, Label, inputClass } from '../ui/Field'

// One part of Setup: a heading, and its fields under a hairline.
function Group({ legend, children }) {
  return (
    <fieldset className="min-w-0 border-t border-line pt-6">
      <legend className="float-left mb-4 w-full text-xl font-bold tracking-tight">{legend}</legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  )
}

// Everything in Setup after the allergies: the household, its diet and
// tastes, and its goals and limits.
export function PreferencesForm() {
  const { preferences, setPreference, toggleRestriction } = useHousehold()
  const sizeProblem = useAccountSetup().problems.householdSize

  return (
    <div className="flex flex-col gap-10">
      <Group legend="Household">
        <div className="grid max-w-xl gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="household-size" className="mb-1.5">
              People eating
            </Label>
            <input
              id="household-size"
              type="number"
              className={inputClass}
              min="1"
              max="20"
              value={preferences.householdSize}
              aria-invalid={Boolean(sizeProblem)}
              onChange={(event) =>
                setPreference('householdSize', Number(event.target.value))
              }
            />
            <Hint>
              Every meal is planned for {preferences.householdSize}{' '}
              {preferences.householdSize === 1 ? 'serving' : 'servings'}.
            </Hint>
            {sizeProblem ? <FieldError>{sizeProblem}</FieldError> : null}
          </div>

          <div>
            <Label htmlFor="planning-period" className="mb-1.5">
              Planning period
            </Label>
            <select
              id="planning-period"
              className={inputClass}
              value={preferences.planningPeriod}
              onChange={(event) =>
                setPreference('planningPeriod', Number(event.target.value))
              }
            >
              {PLANNING_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Group>

      <Group legend="Diet and tastes">
        <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
          {DIETARY_RESTRICTIONS.map((restriction) => (
            <Choice
              key={restriction}
              type="checkbox"
              checked={preferences.dietaryRestrictions.includes(restriction)}
              onChange={() => toggleRestriction(restriction)}
            >
              {restriction}
            </Choice>
          ))}
        </div>

        <AccountTastesFields />
      </Group>

      <Group legend="Goals and limits">
        <NutritionGoalsFields />

        <div className="mt-6 grid max-w-xl gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="budget" className="mb-1.5">
              Grocery budget for the plan ($)
            </Label>
            <input
              id="budget"
              type="number"
              className={inputClass}
              min="0"
              step="5"
              value={preferences.budget}
              onChange={(event) =>
                setPreference('budget', Number(event.target.value))
              }
            />
            <Hint>
              The most the buying agent may spend when it shops for this plan.
              &ldquo;Buy it for me&rdquo; needs one.
            </Hint>
          </div>

          <div>
            <Label htmlFor="cooking-time" className="mb-1.5">
              Time per meal
            </Label>
            <select
              id="cooking-time"
              className={inputClass}
              value={preferences.cookingTime}
              onChange={(event) =>
                setPreference('cookingTime', Number(event.target.value))
              }
            >
              {COOKING_TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Group>
    </div>
  )
}
