import { useMemo, useState } from 'react'
import {
  COMMON_ALLERGENS,
  DIETARY_RESTRICTIONS,
  MEAL_SLOTS,
  SLOT_LABELS,
} from '../../lib/constants'
import { detectedAllergens } from '../../lib/allergySafety'
import {
  blankDraft,
  blankIngredient,
  draftFromRecipe,
  isCustomRecipe,
  recipeWarnings,
  validateDraft,
} from '../../lib/customRecipes'
import { useCustomRecipes } from '../../hooks/useCustomRecipes'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { Banner } from '../common/Banner'
import { Modal } from '../common/Modal'
import { Button, IconButton } from '../ui/Button'
import { Choice, FieldError, Hint, Label, inputClass } from '../ui/Field'
import { Alert, Plus, Trash } from '../ui/icons'

function Field({ id, label, hint, error, children, className }) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5">
        {label}
      </Label>
      {children}
      {error ? <FieldError role="alert">{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}

// One part of the form: a heading and its fields, under a hairline.
function Part({ legend, lede, children }) {
  return (
    <fieldset className="min-w-0 border-t border-line pt-5">
      <legend className="float-left mb-1 flex w-full items-center gap-2 text-lg font-bold tracking-tight">
        {legend}
      </legend>
      {lede ? <p className="clear-both max-w-[56ch] text-sm text-mute">{lede}</p> : null}
      <div className="clear-both pt-3">{children}</div>
    </fieldset>
  )
}

// Requirement 5.8: the user writes a recipe the way they cook it, and the app
// stores it per serving. `recipe` is the one being edited, or null for a new one.
export function RecipeFormModal({ recipe = null, onClose, onSaved }) {
  const { preferences } = useHousehold()
  const { takenNames, saveRecipe } = useCustomRecipes()
  const { plan, renameSlotRecipe } = useMealPlan()

  const previousName = recipe?.name ?? null
  const [draft, setDraft] = useState(() =>
    recipe ? draftFromRecipe(recipe) : blankDraft(),
  )
  const [submitted, setSubmitted] = useState(false)

  const setField = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const toggleInList = (key, value) =>
    setDraft((current) => {
      const list = current[key] ?? []
      return {
        ...current,
        [key]: list.includes(value)
          ? list.filter((item) => item !== value)
          : [...list, value],
      }
    })

  const setIngredient = (index, key, value) =>
    setDraft((current) => {
      const ingredients = current.ingredients.map((row, position) =>
        position === index ? { ...row, [key]: value } : row,
      )
      return { ...current, ingredients }
    })

  const addIngredient = () =>
    setDraft((current) => ({
      ...current,
      ingredients: [...current.ingredients, blankIngredient()],
    }))

  const removeIngredient = (index) =>
    setDraft((current) => ({
      ...current,
      ingredients:
        current.ingredients.length > 1
          ? current.ingredients.filter((_, position) => position !== index)
          : [blankIngredient()],
    }))

  // The user's other recipes and the plan's own: a slot points at a recipe by
  // name, so a clash would make it point at the wrong one.
  const names = useMemo(
    () => [
      ...takenNames(previousName),
      ...plan.recipes
        .filter((item) => !isCustomRecipe(item))
        .map((item) => item.name),
    ],
    [takenNames, previousName, plan.recipes],
  )
  const { errors, recipe: validated } = useMemo(
    () => validateDraft(draft, { takenNames: names }),
    [draft, names],
  )

  // The allergen scan and the warnings run on whatever has been typed so far,
  // so the user sees them while writing rather than only on save.
  const probe = useMemo(
    () => ({
      name: draft.name.trim(),
      tags: draft.tags,
      allergens: draft.allergens,
      ingredients: draft.ingredients
        .filter((row) => row.name.trim())
        .map((row) => ({
          name: row.name.trim(),
          cost: Number(row.cost) || 0,
        })),
    }),
    [draft],
  )

  const detected = useMemo(() => detectedAllergens(probe), [probe])
  const warnings = useMemo(
    () => recipeWarnings(validated ?? probe, preferences),
    [validated, probe, preferences],
  )

  const show = (key) => (submitted ? errors[key] : undefined)

  const submit = (event) => {
    event.preventDefault()
    setSubmitted(true)

    if (!validated) return

    saveRecipe(validated, previousName)
    if (previousName && previousName !== validated.name) {
      renameSlotRecipe(previousName, validated.name)
    }

    onSaved?.(validated, { isNew: !previousName })
    onClose()
  }

  const servings = Math.max(1, Number(draft.makesServings) || 1)

  return (
    <Modal
      title={previousName ? `Edit ${previousName}` : 'Add your own recipe'}
      onClose={onClose}
    >
      <p className="max-w-[56ch] text-mute">
        Enter the amounts and macros for the whole recipe. We divide them by the
        servings it makes, so a meal can be cooked for any number of people.
      </p>

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-8">
        <Part legend="The basics">
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-4">
            <Field id="recipe-name" label="Recipe name" error={show('name')} className="sm:col-span-4">
              <input
                id="recipe-name"
                type="text"
                className={inputClass}
                value={draft.name}
                maxLength={80}
                placeholder="e.g. Grandma's Sunday Chili"
                aria-invalid={Boolean(show('name'))}
                onChange={(event) => setField('name', event.target.value)}
              />
            </Field>

            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-ui font-semibold">Meals it can fill</span>
              <div className="flex min-h-10.5 flex-wrap items-center gap-x-5 gap-y-2">
                {MEAL_SLOTS.map((slot) => (
                  <Choice
                    key={slot}
                    type="checkbox"
                    checked={draft.slots.includes(slot)}
                    onChange={() => toggleInList('slots', slot)}
                  >
                    {SLOT_LABELS[slot]}
                  </Choice>
                ))}
              </div>
              {show('slots') ? (
                <FieldError role="alert">{errors.slots}</FieldError>
              ) : (
                <Hint>
                  Pick every meal this would do for. The planner only offers it
                  for these.
                </Hint>
              )}
            </div>

            <Field id="recipe-servings" label="Servings it makes" error={show('makesServings')}>
              <input
                id="recipe-servings"
                type="number"
                className={inputClass}
                min="1"
                max="50"
                step="1"
                value={draft.makesServings}
                aria-invalid={Boolean(show('makesServings'))}
                onChange={(event) =>
                  setField('makesServings', event.target.value)
                }
              />
            </Field>

            <Field id="recipe-time" label="Cooking time (min)" error={show('cookTimeMinutes')}>
              <input
                id="recipe-time"
                type="number"
                className={inputClass}
                min="0"
                max="600"
                step="5"
                value={draft.cookTimeMinutes}
                aria-invalid={Boolean(show('cookTimeMinutes'))}
                onChange={(event) =>
                  setField('cookTimeMinutes', event.target.value)
                }
              />
            </Field>
          </div>
        </Part>

        <Part
          legend="Macros for the whole recipe"
          lede="Your numbers, not ours. We show them per serving and label them as yours wherever they appear."
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Field id="recipe-calories" label="Calories" error={show('calories')}>
              <input
                id="recipe-calories"
                type="number"
                className={inputClass}
                min="0"
                step="10"
                value={draft.calories}
                aria-invalid={Boolean(show('calories'))}
                onChange={(event) => setField('calories', event.target.value)}
              />
            </Field>

            <Field id="recipe-protein" label="Protein (g)" error={show('protein')}>
              <input
                id="recipe-protein"
                type="number"
                className={inputClass}
                min="0"
                step="1"
                value={draft.protein}
                aria-invalid={Boolean(show('protein'))}
                onChange={(event) => setField('protein', event.target.value)}
              />
            </Field>

            <Field id="recipe-carbs" label="Carbs (g)" error={show('carbs')}>
              <input
                id="recipe-carbs"
                type="number"
                className={inputClass}
                min="0"
                step="1"
                value={draft.carbs}
                aria-invalid={Boolean(show('carbs'))}
                onChange={(event) => setField('carbs', event.target.value)}
              />
            </Field>

            <Field id="recipe-fat" label="Fat (g)" error={show('fat')}>
              <input
                id="recipe-fat"
                type="number"
                className={inputClass}
                min="0"
                step="1"
                value={draft.fat}
                aria-invalid={Boolean(show('fat'))}
                onChange={(event) => setField('fat', event.target.value)}
              />
            </Field>
          </div>

          {validated ? (
            <p className="mt-3 font-semibold" role="status">
              Per serving, across {servings}{' '}
              {servings === 1 ? 'serving' : 'servings'}: about{' '}
              {validated.nutritionPerServing.calories} kcal ·{' '}
              {validated.nutritionPerServing.protein} g protein ·{' '}
              {validated.nutritionPerServing.carbs} g carbs ·{' '}
              {validated.nutritionPerServing.fat} g fat.
            </p>
          ) : null}

          <Field
            id="recipe-nutrition-source"
            label="Where the numbers come from (optional)"
            hint="Shown next to the macros, so nobody mistakes an estimate for a verified value."
            className="mt-5"
          >
            <input
              id="recipe-nutrition-source"
              type="text"
              className={inputClass}
              value={draft.nutritionSource}
              placeholder="e.g. Added up from the package labels"
              onChange={(event) =>
                setField('nutritionSource', event.target.value)
              }
            />
          </Field>
        </Part>

        <Part
          legend="Ingredients"
          lede="Amounts and prices for the whole recipe. Prices keep your budget and grocery list honest."
        >
          {/* name · amount · unit · cost · remove; on a phone, two per line */}
          <ul className="grid gap-2">
            <li
              className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_2.25rem] gap-2 text-sm font-semibold text-mute max-sm:hidden"
              aria-hidden="true"
            >
              <span>Ingredient</span>
              <span>Amount</span>
              <span>Unit</span>
              <span>Cost $</span>
              <span />
            </li>
            {draft.ingredients.map((row, index) => (
              <li
                className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_2.25rem] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] max-sm:border-b max-sm:border-line max-sm:pb-3"
                key={index}
              >
                <input
                  type="text"
                  className={`${inputClass} max-sm:col-span-4`}
                  value={row.name}
                  placeholder="Ground beef"
                  aria-label={`Ingredient ${index + 1} name`}
                  onChange={(event) =>
                    setIngredient(index, 'name', event.target.value)
                  }
                />
                <input
                  type="number"
                  className={inputClass}
                  min="0"
                  step="any"
                  value={row.quantity}
                  placeholder="1"
                  aria-label={`Ingredient ${index + 1} amount`}
                  onChange={(event) =>
                    setIngredient(index, 'quantity', event.target.value)
                  }
                />
                <input
                  type="text"
                  className={inputClass}
                  value={row.unit}
                  placeholder="lb"
                  aria-label={`Ingredient ${index + 1} unit`}
                  onChange={(event) =>
                    setIngredient(index, 'unit', event.target.value)
                  }
                />
                <input
                  type="number"
                  className={inputClass}
                  min="0"
                  step="0.01"
                  value={row.cost}
                  placeholder="0.00"
                  aria-label={`Ingredient ${index + 1} cost in dollars`}
                  onChange={(event) =>
                    setIngredient(index, 'cost', event.target.value)
                  }
                />
                <IconButton
                  aria-label={`Remove ingredient ${index + 1}`}
                  title={`Remove ingredient ${index + 1}`}
                  onClick={() => removeIngredient(index)}
                >
                  <Trash />
                </IconButton>
              </li>
            ))}
          </ul>

          {show('ingredients') ? (
            <FieldError role="alert">{errors.ingredients}</FieldError>
          ) : null}

          <Button size="sm" className="mt-3" onClick={addIngredient}>
            <Plus size={14} /> Add another ingredient
          </Button>
        </Part>

        <Part
          legend={
            <>
              <Alert size={18} />
              Allergens and diets
            </>
          }
          lede="Tick anything this contains. We also read the ingredient names and add what we find, so a missed tick cannot make the recipe look safe."
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {COMMON_ALLERGENS.map((allergen) => {
              const found = detected.includes(allergen)
              return (
                <Choice
                  key={allergen}
                  type="checkbox"
                  checked={found || draft.allergens.includes(allergen)}
                  disabled={found}
                  onChange={() => toggleInList('allergens', allergen)}
                >
                  {allergen}
                  {found ? <span className="block text-sm">found in ingredients</span> : null}
                </Choice>
              )
            })}
          </div>

          <span className="mt-6 mb-1.5 block text-ui font-semibold">Diets this recipe fits</span>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
            {DIETARY_RESTRICTIONS.map((restriction) => (
              <Choice
                key={restriction}
                type="checkbox"
                checked={draft.tags.includes(restriction)}
                onChange={() => toggleInList('tags', restriction)}
              >
                {restriction}
              </Choice>
            ))}
          </div>
          <Hint>
            Your plan only uses a recipe when it is ticked for every diet you
            set in Setup.
          </Hint>
        </Part>

        <Part legend="How to cook it">
          <Field
            id="recipe-instructions"
            label="Steps, one per line"
            error={show('instructions')}
            hint="Each line becomes a numbered step in the recipe view."
          >
            <textarea
              id="recipe-instructions"
              className={`${inputClass} min-h-28 resize-y`}
              rows="6"
              value={draft.instructions}
              placeholder={'Brown the beef with the onion.\nAdd the tomatoes and simmer for 30 minutes.'}
              aria-invalid={Boolean(show('instructions'))}
              onChange={(event) => setField('instructions', event.target.value)}
            />
          </Field>
        </Part>

        {warnings.length ? (
          <Banner variant="warning" title="Worth checking" compact>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Banner>
        ) : null}

        <div>
          {submitted && Object.keys(errors).length ? (
            <p className="mb-3 font-semibold text-danger" role="alert">
              Fix the marked fields, then save.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg">
              {previousName ? 'Save changes' : 'Save recipe'}
            </Button>
            <Button size="lg" onClick={onClose}>
              Cancel
            </Button>
          </div>

          <p className="mt-4 max-w-[56ch] text-sm text-mute">
            Your macros and prices are stored as you entered them and shown as
            yours and unverified. Allergy filtering still runs over the ingredient
            names, but it is not a guarantee — read the labels before you cook.
          </p>
        </div>
      </form>
    </Modal>
  )
}
