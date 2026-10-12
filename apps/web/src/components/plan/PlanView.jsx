import { useCallback, useState } from 'react'
import { CURRENT_WEEK, cookingTimeLabel } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { usePlanSummary } from '../../hooks/usePlanSummary'
import { Banner } from '../common/Banner'
import { PlanBuildingState } from '../common/LoadingState'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { RecipeFormModal } from '../recipes/RecipeFormModal'
import { Button, TextButton } from '../ui/Button'
import { Alert, Arrow, DrawnTick, Plus, Undo } from '../ui/icons'
import { PlanSummary } from './PlanSummary'
import { RecipeShelf } from './RecipeShelf'
import { Wall } from './Wall'
import { WEEK_PANEL_ID, WeekTabs } from './WeekTabs'

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
  const closeRecipe = useCallback(() => setOpenRecipe(null), [])

  const loading = status === 'loading'
  const empty = isWeekEmpty(plan, currentWeek)
  const confirmed = plan.confirmedWeek === currentWeek

  // A shelf belongs to the week it was opened in.
  const selected = openRecipe?.week === currentWeek ? openRecipe : null

  const avoiding = preferences.allergies.length
    ? `avoiding ${preferences.allergies.join(', ')}`
    : 'no allergies'

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-extrabold tracking-tight max-sm:text-3xl">Your meal plan</h1>
          <p className="mt-2 text-mute">
            {preferences.householdSize}{' '}
            {preferences.householdSize === 1 ? 'person' : 'people'},{' '}
            {preferences.planningPeriod} days,{' '}
            {Number(preferences.budget) > 0
              ? `$${preferences.budget} to spend`
              : 'no spending limit'}
            , <strong className="font-bold text-ink">{avoiding}</strong>
            {preferences.dietaryRestrictions.length
              ? `, ${preferences.dietaryRestrictions.join(', ').toLowerCase()}`
              : ''}
            , {cookingTimeLabel(preferences.cookingTime).toLowerCase()}
            <TextButton className="ml-3" onClick={onEditSetup}>
              Edit setup
            </TextButton>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1.5">
            <WeekTabs />
          </span>
          {/* Asks the planner again, for the whole planning period. It leaves
              out the meals it showed in the last two weeks, so these are new. */}
          <Button onClick={generatePlan} disabled={loading}>
            {loading ? 'Remaking your plan…' : 'Remake the plan'}
          </Button>
          <Button onClick={() => clearWeek(currentWeek)} disabled={loading}>
            Clear this week
          </Button>
          <Button onClick={() => setEditRecipe({ recipe: null })}>
            <Plus size={14} /> Add your own recipe
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 empty:hidden">
        {error ? (
          <Banner variant="error" title="Something went wrong" onDismiss={dismissError}>
            {error}
          </Banner>
        ) : null}

        {summary.warnings.map((warning) => (
          <Banner key={warning} variant="warning" title="Heads up">
            {warning}
          </Banner>
        ))}

        {note ? (
          <Banner variant="notice" title="What changed" onDismiss={dismissNote}>
            {note}
            {canUndo ? (
              <Button size="sm" className="ml-3 align-middle" onClick={undo}>
                <Undo size={14} /> Undo the change to Week {undoWeek + 1}
              </Button>
            ) : null}
          </Banner>
        ) : null}
      </div>

      <div
        className="mt-6"
        id={WEEK_PANEL_ID}
        role="tabpanel"
        aria-label={`Week ${currentWeek + 1}`}
      >
        {loading ? (
          <PlanBuildingState />
        ) : empty ? (
          <section>
            <h2 className="text-xl font-bold tracking-tight">Nothing planned for this week</h2>
            <p className="mt-2 max-w-[60ch] text-mute">
              The planner chooses meals for the {preferences.planningPeriod} days
              of your planning period. For a longer plan, change the planning
              period in Setup and build it again.
            </p>
            <Button variant="primary" className="mt-4" onClick={onEditSetup}>
              Edit setup
            </Button>
          </section>
        ) : (
          <>
            <PlanSummary week={currentWeek} />
            <p className="mt-3 mb-5 text-sm text-mute">{weekStatus(currentWeek)}</p>

            <Wall
              week={currentWeek}
              selected={selected}
              onSelect={setOpenRecipe}
              shelf={
                selected ? (
                  <RecipeShelf
                    {...selected}
                    onClose={closeRecipe}
                    onEditRecipe={(recipe) => setEditRecipe({ recipe })}
                  />
                ) : null
              }
            />

            <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-y border-line py-5">
              <div className="min-w-0 flex-[1_1_22rem]">
                <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                  {confirmed ? <DrawnTick className="draw shrink-0 text-ok" /> : null}
                  {confirmed ? 'This week is confirmed' : 'Happy with this week?'}
                </h2>
                <p className="mt-1 text-mute">
                  {confirmed
                    ? 'Your grocery list is built from these meals. Change a meal and it updates.'
                    : 'Confirm it to turn these meals into a grocery list the buying agent can shop for.'}
                </p>
                {summary.problemDays.length ? (
                  <p className="mt-2 flex gap-2 font-semibold text-danger">
                    <Alert className="mt-1 shrink-0" />
                    <span>
                      Fix the days marked above before confirming:{' '}
                      {summary.problemDays.join(', ')}.
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2.5 max-sm:w-full max-sm:flex-col">
                <Button
                  variant={confirmed ? 'default' : 'primary'}
                  size="lg"
                  onClick={() => confirmWeek(currentWeek)}
                  disabled={Boolean(summary.problemDays.length)}
                >
                  {confirmed ? 'Re-confirm this week' : 'Confirm this week'}
                </Button>
                {confirmed ? (
                  <Button variant="primary" size="lg" className="arrive" onClick={onGoToGrocery}>
                    Go to grocery list <Arrow size={16} />
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <details className="mt-7">
        <summary className="w-fit rounded-chip py-1 font-semibold">How this page works</summary>
        <ul className="mt-3 max-w-[58ch] list-disc space-y-1.5 pl-5 text-mute">
          <li>
            Open a meal to read its recipe, accept or reject it, or change it.
            Leftovers come from a meal cooked earlier in the plan.
          </li>
          <li>
            Each meal is planned for your household. Open a meal to cook it for
            a different number of people.
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
            A flag on a meal says what is different about it: yours, leftovers,
            changed, or not safe to cook. The line under each day is calories
            and protein per person.
          </li>
          <li>
            Your own recipes show up wherever they fit, marked
            &ldquo;Yours&rdquo;. Add one here, or manage them all in Setup.
          </li>
        </ul>
      </details>

      <SafetyDisclaimer />

      {editRecipe ? (
        <RecipeFormModal
          recipe={editRecipe.recipe}
          onClose={() => setEditRecipe(null)}
        />
      ) : null}
    </>
  )
}
