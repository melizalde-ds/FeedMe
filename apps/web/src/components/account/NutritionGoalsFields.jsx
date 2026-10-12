import { MACRO_TOLERANCE, MIN_CALORIES, macroCalories, splitMacros } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { ui } from '../ui/styles'

const FIELDS = [
  { key: 'calories', id: 'calorie-goal', label: 'Daily calories per person', unit: 'kcal', step: 50 },
  { key: 'protein', id: 'protein-goal', label: 'Daily protein per person', unit: 'g', step: 5 },
  { key: 'carbs', id: 'carbs-goal', label: 'Daily carbs per person', unit: 'g', step: 5 },
  { key: 'fat', id: 'fat-goal', label: 'Daily fat per person', unit: 'g', step: 1 },
]

// A signed-in user's nutrition goals. The database refuses goals under
// 1200 kcal, and goals whose macros (4/4/9 kcal per gram) land more than 10%
// away from the calorie target, so both are checked as the user types.
export function NutritionGoalsFields() {
  const { preferences, setNutritionGoal, updatePreferences } = useHousehold()
  const { problems } = useAccountSetup()
  const goals = preferences.nutritionGoals

  const recalculate = () =>
    updatePreferences((current) => ({
      nutritionGoals: {
        ...current.nutritionGoals,
        ...splitMacros(goals.calories, goals.protein),
      },
    }))

  const fromMacros = macroCalories(goals)

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className={ui.label} htmlFor={field.id}>
              {field.label} ({field.unit})
            </label>
            <input
              id={field.id}
              type="number"
              inputMode="numeric"
              className={ui.input}
              min={field.key === 'calories' ? MIN_CALORIES : 0}
              step={field.step}
              value={goals[field.key] ?? ''}
              aria-invalid={Boolean(problems[field.key])}
              aria-describedby={problems[field.key] ? `${field.id}-error` : undefined}
              onChange={(event) =>
                setNutritionGoal(
                  field.key,
                  event.target.value === '' ? '' : Number(event.target.value),
                )
              }
            />
            {problems[field.key] ? (
              <p id={`${field.id}-error`} className={ui.error}>
                {problems[field.key]}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <p className={ui.hint} role="status">
        Protein, carbs and fat come to about {fromMacros.toLocaleString()} kcal. They need to be
        within {MACRO_TOLERANCE * 100}% of your calorie target, which is at least{' '}
        {MIN_CALORIES.toLocaleString()} kcal.
      </p>
      {problems.macros ? (
        <p className={ui.error} role="alert">
          {problems.macros}
        </p>
      ) : null}
      <button type="button" className={`${ui.buttonSmall} mt-2`} onClick={recalculate}>
        Recalculate carbs and fat
      </button>
      <p className={ui.hint}>
        Fills carbs and fat from the calories left after protein, with 5 parts going to carbs for every 3 to fat, by calories.
      </p>
    </div>
  )
}
