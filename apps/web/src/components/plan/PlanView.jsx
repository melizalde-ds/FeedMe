import { useState } from 'react'
import { CURRENT_WEEK, cookingTimeLabel } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { usePlanSummary } from '../../hooks/usePlanSummary'
import { Banner } from '../common/Banner'
import { PlanBuildingState } from '../common/LoadingState'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { RecipeFormModal } from '../recipes/RecipeFormModal'
import { PlanSummary } from './PlanSummary'
import { PlanTable } from './PlanTable'
import { RecipeModal } from './RecipeModal'
import { WeekTabs } from './WeekTabs'

const weekStatus = (week) =>
  week === CURRENT_WEEK
    ? 'The first week of the plan built from your setup. Change a dinner and the next day’s leftovers follow it.'
    : `Week ${week + 1} of the plan, for a planning period longer than a week.`

export function PlanView({ onEditSetup, onGoToGrocery }) {
  const { preferences } = useHousehold()
  const {
    plan,
    currentWeek,
    status,
    note,
    error,
    canUndo,
    undoWeek,
    undo,
    generatePlan,
    clearWeek,
    confirmWeek,
    dismissNote,
    dismissError,
  } = useMealPlan()

  const [openRecipe, setOpenRecipe] = useState(null)
  const [editRecipe, setEditRecipe] = useState(null)
  const summary = usePlanSummary(currentWeek)

  const loading = status === 'loading'
  const empty = isWeekEmpty(plan, currentWeek)
  const confirmed = plan.confirmedWeek === currentWeek

  const avoiding = preferences.allergies.length
    ? `Avoiding ${preferences.allergies.join(', ')}`
    : 'No allergies'

  return (
    <>
      <h1 className="page-title">Your meal plan</h1>

      <div className="summary-strip">
        <p className="summary-strip__text">
          {preferences.householdSize}{' '}
          {preferences.householdSize === 1 ? 'person' : 'people'} ·{' '}
          {preferences.planningPeriod} days ·{' '}
          {Number(preferences.budget) > 0
            ? `$${preferences.budget} to spend`
            : 'no spending limit'}{' '}
          · {avoiding}
          {preferences.dietaryRestrictions.length
            ? ` · ${preferences.dietaryRestrictions.join(', ')}`
            : ''}{' '}
          · {cookingTimeLabel(preferences.cookingTime)}
        </p>
        <button type="button" className="button button--small" onClick={onEditSetup}>
          Edit setup
        </button>
      </div>

      <div className="action-bar">
        {/* Asks the planner again, for the whole planning period. It leaves
            out the meals it showed in the last two weeks, so these are new. */}
        <button
          type="button"
          className="button button--accent"
          onClick={generatePlan}
          disabled={loading}
        >
          {loading ? 'Remaking your plan…' : 'Remake the plan'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => clearWeek(currentWeek)}
          disabled={loading}
        >
          Clear this week
        </button>
        <button
          type="button"
          className="button"
          onClick={() => setEditRecipe({ recipe: null })}
        >
          Add your own recipe
        </button>
      </div>

      {error ? (
        <Banner variant="error" title="Something went wrong" onDismiss={dismissError}>
          {error}
        </Banner>
      ) : null}

      {loading ? <PlanBuildingState /> : null}

      {summary.warnings.map((warning) => (
        <Banner key={warning} variant="warning" title="Heads up">
          {warning}
        </Banner>
      ))}

      {note ? (
        <Banner variant="notice" title="What changed" onDismiss={dismissNote}>
          {note}
          {canUndo ? (
            <p className="banner__action">
              <button type="button" className="button button--small" onClick={undo}>
                Undo the change to Week {undoWeek + 1}
              </button>
            </p>
          ) : null}
        </Banner>
      ) : null}

      <WeekTabs />
      <p className="week-status">{weekStatus(currentWeek)}</p>

      {empty ? (
        <section className="panel panel--empty">
          <h2 className="panel__title">Nothing planned for this week</h2>
          <p className="panel__lede">
            The planner chooses meals for the {preferences.planningPeriod} days
            of your planning period. For a longer plan, change the planning
            period in Setup and build it again.
          </p>
          <button
            type="button"
            className="button button--primary button--large"
            onClick={onEditSetup}
          >
            Edit setup
          </button>
        </section>
      ) : (
        <>
          <PlanSummary week={currentWeek} />
          <PlanTable week={currentWeek} onOpenRecipe={setOpenRecipe} />

          <div className="confirm-bar">
            <div>
              <h2 className="confirm-bar__title">
                {confirmed ? 'This week is confirmed' : 'Happy with this week?'}
              </h2>
              <p className="confirm-bar__lede">
                {confirmed
                  ? 'Your grocery list is built from these meals. Change a meal and it updates.'
                  : 'Confirm it to turn these meals into a grocery list the buying agent can shop for.'}
              </p>
            </div>
            <div className="confirm-bar__actions">
              <button
                type="button"
                className="button button--primary button--large"
                onClick={() => confirmWeek(currentWeek)}
                disabled={Boolean(summary.problemDays.length)}
              >
                {confirmed ? 'Re-confirm this week' : 'Confirm this week'}
              </button>
              {confirmed ? (
                <button type="button" className="button" onClick={onGoToGrocery}>
                  Go to grocery list
                </button>
              ) : null}
            </div>
          </div>

          {summary.problemDays.length ? (
            <p className="fine-print fine-print--alert">
              Fix the days marked in the Check column before confirming:{' '}
              {summary.problemDays.join(', ')}.
            </p>
          ) : null}
        </>
      )}

      <section className="how-to">
        <h2 className="how-to__title">How to use this</h2>
        <ul className="how-to__list">
          <li>
            Pick a recipe or a Leftovers option for any meal. Leftovers come from
            a meal cooked earlier in the plan.
          </li>
          <li>
            The small box beside each meal is the number of people. Leave it
            blank to use your household size.
          </li>
          <li>
            &ldquo;Remake the plan&rdquo; asks the planner for new meals for
            the whole planning period. It takes about half a minute.
          </li>
          <li>
            Change an allergy or diet in Setup and unsafe meals are swapped
            automatically, with a note telling you what moved.
          </li>
          <li>
            Red text in Check means something needs fixing. The grey line is
            calories and protein per person for that day.
          </li>
          <li>
            Your own recipes show up in every dropdown they fit, marked
            &ldquo;yours&rdquo;. Add one here, or manage them all in Setup.
          </li>
        </ul>
      </section>

      <SafetyDisclaimer />

      {openRecipe ? (
        <RecipeModal
          {...openRecipe}
          onClose={() => setOpenRecipe(null)}
          onEditRecipe={(recipe) => {
            setOpenRecipe(null)
            setEditRecipe({ recipe })
          }}
        />
      ) : null}

      {editRecipe ? (
        <RecipeFormModal
          recipe={editRecipe.recipe}
          onClose={() => setEditRecipe(null)}
        />
      ) : null}
    </>
  )
}
