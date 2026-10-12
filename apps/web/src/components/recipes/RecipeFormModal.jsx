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
import { Modal } from '../common/Modal'

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
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
      <p className="modal__context">
        Enter the amounts and macros for the whole recipe. We divide them by the
        servings it makes, so a meal can be cooked for any number of people.
      </p>

      <form onSubmit={submit} noValidate>
        <fieldset className="fieldset">
          <legend className="fieldset__legend">The basics</legend>

          <Field id="recipe-name" label="Recipe name" error={show('name')}>
            <input
              id="recipe-name"
              type="text"
              className="input"
              value={draft.name}
              maxLength={80}
              placeholder="e.g. Grandma's Sunday Chili"
              onChange={(event) => setField('name', event.target.value)}
            />
          </Field>

          <div className="field">
            <span className="field__label">Meals it can fill</span>
            <div className="checkbox-grid">
              {MEAL_SLOTS.map((slot) => (
                <label key={slot} className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.slots.includes(slot)}
                    onChange={() => toggleInList('slots', slot)}
                  />
                  <span>{SLOT_LABELS[slot]}</span>
                </label>
              ))}
            </div>
            {show('slots') ? (
              <p className="field__error" role="alert">
                {errors.slots}
              </p>
            ) : (
              <p className="field__hint">
                Pick every meal this would do for. The planner only offers it
                for these.
              </p>
            )}
          </div>

          <div className="number-grid">
            <Field
              id="recipe-servings"
              label="Servings it makes"
              error={show('makesServings')}
            >
              <input
                id="recipe-servings"
                type="number"
                className="input"
                min="1"
                max="50"
                step="1"
                value={draft.makesServings}
                onChange={(event) =>
                  setField('makesServings', event.target.value)
                }
              />
            </Field>

            <Field
              id="recipe-time"
              label="Cooking time (min)"
              error={show('cookTimeMinutes')}
            >
              <input
                id="recipe-time"
                type="number"
                className="input"
                min="0"
                max="600"
                step="5"
                value={draft.cookTimeMinutes}
                onChange={(event) =>
                  setField('cookTimeMinutes', event.target.value)
                }
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">
            Macros for the whole recipe
          </legend>
          <p className="fieldset__lede">
            Your numbers, not ours. We show them per serving and label them as
            yours wherever they appear.
          </p>

          <div className="number-grid">
            <Field id="recipe-calories" label="Calories" error={show('calories')}>
              <input
                id="recipe-calories"
                type="number"
                className="input"
                min="0"
                step="10"
                value={draft.calories}
                onChange={(event) => setField('calories', event.target.value)}
              />
            </Field>

            <Field id="recipe-protein" label="Protein (g)" error={show('protein')}>
              <input
                id="recipe-protein"
                type="number"
                className="input"
                min="0"
                step="1"
                value={draft.protein}
                onChange={(event) => setField('protein', event.target.value)}
              />
            </Field>

            <Field id="recipe-carbs" label="Carbs (g)" error={show('carbs')}>
              <input
                id="recipe-carbs"
                type="number"
                className="input"
                min="0"
                step="1"
                value={draft.carbs}
                onChange={(event) => setField('carbs', event.target.value)}
              />
            </Field>

            <Field id="recipe-fat" label="Fat (g)" error={show('fat')}>
              <input
                id="recipe-fat"
                type="number"
                className="input"
                min="0"
                step="1"
                value={draft.fat}
                onChange={(event) => setField('fat', event.target.value)}
              />
            </Field>
          </div>

          {validated ? (
            <p className="fieldset__summary" role="status">
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
          >
            <input
              id="recipe-nutrition-source"
              type="text"
              className="input"
              value={draft.nutritionSource}
              placeholder="e.g. Added up from the package labels"
              onChange={(event) =>
                setField('nutritionSource', event.target.value)
              }
            />
          </Field>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Ingredients</legend>
          <p className="fieldset__lede">
            Amounts and prices for the whole recipe. Prices keep your budget and
            grocery list honest.
          </p>

          <ul className="ingredient-rows">
            <li className="ingredient-row ingredient-row--head" aria-hidden="true">
              <span>Ingredient</span>
              <span>Amount</span>
              <span>Unit</span>
              <span>Cost $</span>
              <span />
            </li>
            {draft.ingredients.map((row, index) => (
              <li className="ingredient-row" key={index}>
                <input
                  type="text"
                  className="input"
                  value={row.name}
                  placeholder="Ground beef"
                  aria-label={`Ingredient ${index + 1} name`}
                  onChange={(event) =>
                    setIngredient(index, 'name', event.target.value)
                  }
                />
                <input
                  type="number"
                  className="input"
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
                  className="input"
                  value={row.unit}
                  placeholder="lb"
                  aria-label={`Ingredient ${index + 1} unit`}
                  onChange={(event) =>
                    setIngredient(index, 'unit', event.target.value)
                  }
                />
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.01"
                  value={row.cost}
                  placeholder="0.00"
                  aria-label={`Ingredient ${index + 1} cost in dollars`}
                  onChange={(event) =>
                    setIngredient(index, 'cost', event.target.value)
                  }
                />
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => removeIngredient(index)}
                >
                  Remove
                  <span className="visually-hidden">
                    {' '}
                    ingredient {index + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {show('ingredients') ? (
            <p className="field__error" role="alert">
              {errors.ingredients}
            </p>
          ) : null}

          <p className="panel__actions panel__actions--tight">
            <button type="button" className="button" onClick={addIngredient}>
              Add another ingredient
            </button>
          </p>
        </fieldset>

        <fieldset className="fieldset fieldset--allergy">
          <legend className="fieldset__legend">
            Allergens and diets
            <span className="pill">Safety first</span>
          </legend>
          <p className="fieldset__lede">
            Tick anything this contains. We also read the ingredient names and
            add what we find, so a missed tick cannot make the recipe look safe.
          </p>

          <div className="checkbox-grid">
            {COMMON_ALLERGENS.map((allergen) => {
              const found = detected.includes(allergen)
              return (
                <label key={allergen} className="checkbox">
                  <input
                    type="checkbox"
                    checked={found || draft.allergens.includes(allergen)}
                    disabled={found}
                    onChange={() => toggleInList('allergens', allergen)}
                  />
                  <span>
                    {allergen}
                    {found ? (
                      <span className="checkbox__note"> found in ingredients</span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </div>

          <div className="field">
            <span className="field__label">Diets this recipe fits</span>
            <div className="checkbox-grid">
              {DIETARY_RESTRICTIONS.map((restriction) => (
                <label key={restriction} className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.tags.includes(restriction)}
                    onChange={() => toggleInList('tags', restriction)}
                  />
                  <span>{restriction}</span>
                </label>
              ))}
            </div>
            <p className="field__hint">
              Your plan only uses a recipe when it is ticked for every diet you
              set in Setup.
            </p>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">How to cook it</legend>

          <Field
            id="recipe-instructions"
            label="Steps, one per line"
            error={show('instructions')}
            hint="Each line becomes a numbered step in the recipe view."
          >
            <textarea
              id="recipe-instructions"
              className="input input--textarea"
              rows="6"
              value={draft.instructions}
              placeholder={'Brown the beef with the onion.\nAdd the tomatoes and simmer for 30 minutes.'}
              onChange={(event) => setField('instructions', event.target.value)}
            />
          </Field>
        </fieldset>

        {warnings.length ? (
          <div className="alert alert--soft" role="status">
            <strong>Worth checking:</strong>
            <ul className="alert__list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {submitted && Object.keys(errors).length ? (
          <p className="fine-print fine-print--alert" role="alert">
            Fix the fields marked above, then save.
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="submit" className="button button--primary button--large">
            {previousName ? 'Save changes' : 'Save recipe'}
          </button>
          <button type="button" className="button button--large" onClick={onClose}>
            Cancel
          </button>
        </div>

        <p className="fine-print">
          Your macros and prices are stored as you entered them and shown as
          yours and unverified. Allergy filtering still runs over the ingredient
          names, but it is not a guarantee — read the labels before you cook.
        </p>
      </form>
    </Modal>
  )
}
