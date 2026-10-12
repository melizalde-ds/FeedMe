import {
  COOKING_TIME_OPTIONS,
  DIETARY_RESTRICTIONS,
  PLANNING_PERIOD_OPTIONS,
} from '../../lib/constants'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { AccountTastesFields } from '../account/AccountTastesFields'
import { NutritionGoalsFields } from '../account/NutritionGoalsFields'

// Everything in Setup after the allergies: the household, its diet and
// tastes, and its goals and limits.
export function PreferencesForm() {
  const { preferences, setPreference, toggleRestriction } = useHousehold()
  const sizeProblem = useAccountSetup().problems.householdSize

  return (
    <div className="fieldset-grid">
      <fieldset className="fieldset">
        <legend className="fieldset__legend">Household</legend>

        <div className="field">
          <label className="field__label" htmlFor="household-size">
            People eating
          </label>
          <input
            id="household-size"
            type="number"
            className="input"
            min="1"
            max="20"
            value={preferences.householdSize}
            onChange={(event) =>
              setPreference('householdSize', Number(event.target.value))
            }
          />
          <p className="field__hint">
            Every meal is planned for {preferences.householdSize}{' '}
            {preferences.householdSize === 1 ? 'serving' : 'servings'}.
          </p>
          {sizeProblem ? (
            <p className="mt-1 text-sm font-semibold text-bad">{sizeProblem}</p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="planning-period">
            Planning period
          </label>
          <select
            id="planning-period"
            className="input"
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
      </fieldset>

      <fieldset className="fieldset">
        <legend className="fieldset__legend">Diet and tastes</legend>

        <div className="checkbox-grid checkbox-grid--single">
          {DIETARY_RESTRICTIONS.map((restriction) => (
            <label key={restriction} className="checkbox">
              <input
                type="checkbox"
                checked={preferences.dietaryRestrictions.includes(restriction)}
                onChange={() => toggleRestriction(restriction)}
              />
              <span>{restriction}</span>
            </label>
          ))}
        </div>

        <AccountTastesFields />
      </fieldset>

      <fieldset className="fieldset">
        <legend className="fieldset__legend">Goals and limits</legend>

        <NutritionGoalsFields />

        <div className="field">
          <label className="field__label" htmlFor="budget">
            Grocery budget for the plan ($)
          </label>
          <input
            id="budget"
            type="number"
            className="input"
            min="0"
            step="5"
            value={preferences.budget}
            onChange={(event) =>
              setPreference('budget', Number(event.target.value))
            }
          />
          <p className="field__hint">
            The most the buying agent may spend when it shops for this plan.
            &ldquo;Buy it for me&rdquo; needs one.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="cooking-time">
            Time per meal
          </label>
          <select
            id="cooking-time"
            className="input"
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
      </fieldset>
    </div>
  )
}
