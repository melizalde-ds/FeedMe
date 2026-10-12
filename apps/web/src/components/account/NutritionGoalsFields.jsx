import { MACRO_TOLERANCE, MIN_CALORIES, macroCalories, splitMacros } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { Button } from '../ui/Button'
import { FieldError, Hint, Label, inputClass } from '../ui/Field'

// Every field steps by 1. A larger step made the browser refuse the whole
// form, silently, for any value off that step: 2010 kcal, 103 g of protein,
// or whatever "Recalculate" wrote for carbs.
const FIELDS = [
  { key: 'calories', id: 'calorie-goal', label: 'Daily calories per person', unit: 'kcal', step: 1 },
  { key: 'protein', id: 'protein-goal', label: 'Daily protein per person', unit: 'g', step: 1 },
  { key: 'carbs', id: 'carbs-goal', label: 'Daily carbs per person', unit: 'g', step: 1 },
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col">
            <Label htmlFor={field.id} className="mb-1.5 grow">
              {field.label} ({field.unit})
            </Label>
            <input
              id={field.id}
              type="number"
              inputMode="numeric"
              className={inputClass}
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
              <FieldError id={`${field.id}-error`}>{problems[field.key]}</FieldError>
            ) : null}
          </div>
        ))}
      </div>

      <Hint role="status" className="max-w-[58ch]">
        Protein, carbs and fat come to about {fromMacros.toLocaleString()} kcal. They need to be
        within {MACRO_TOLERANCE * 100}% of your calorie target, which is at least{' '}
        {MIN_CALORIES.toLocaleString()} kcal.
      </Hint>
      {problems.macros ? <FieldError role="alert">{problems.macros}</FieldError> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" onClick={recalculate}>
          Recalculate carbs and fat
        </Button>
        <p className="max-w-[60ch] text-sm text-mute">
          Fills carbs and fat from the calories left after protein, with 5 parts going to carbs for
          every 3 to fat, by calories.
        </p>
      </div>
    </div>
  )
}
