// Direction 1, "Label": the plan set like the panel on the back of a pack.
// Heavy and hairline rules do the grouping, every figure sits in a column,
// and allergens are stated the way a label states them.
import './label.css'
import { Alert, Check, Close, ThemeIcon, Undo } from './icons.jsx'
import {
  MEAL_SLOTS,
  MEAL_STATUS,
  PREFS,
  SLOT_LABELS,
  grams,
  isOwn,
  kcal,
  percent,
  setupSummary,
  usePlanModel,
  useTheme,
} from './model.js'
import { MealSelect, PeopleInput } from './fields.jsx'
import {
  ACCOUNT_EMAIL,
  HOW_TO,
  PLAN_BUILDING,
  SAFETY,
  mealMeta,
  nutritionHeading,
  recipeNote,
  useRecipeFocus,
} from './shared.js'

const STEPS = ['setup', 'plan', 'grocery']
const STEP_NAMES = { setup: 'Setup', plan: 'Plan', grocery: 'Grocery' }

function Band({ m, theme }) {
  return (
    <header className="lb-band">
      <p className="lb-word">FeedMe</p>
      <nav className="lb-nav" aria-label="Main">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            className="lb-tab"
            aria-current={m.view === step ? 'page' : undefined}
            onClick={() => m.setView(step)}
          >
            {STEP_NAMES[step]}
            {step === 'grocery' && !m.groceryReady ? (
              <span className="lb-tab-hint">confirm a week first</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="lb-account">
        <span className="lb-email" title={ACCOUNT_EMAIL}>
          {ACCOUNT_EMAIL}
        </span>
        <button type="button" className="lb-band-button">
          Sign out
        </button>
        <button
          type="button"
          className="lb-band-button lb-band-icon"
          aria-label={theme.label}
          title={theme.label}
          onClick={theme.cycle}
        >
          <ThemeIcon choice={theme.choice} />
        </button>
      </div>
    </header>
  )
}

// The household, stated the way a pack states its contents.
function Statement({ m }) {
  const setup = setupSummary()
  return (
    <div className="lb-statement">
      <p>
        <span className="lb-lead">Planned for</span> {setup.people}, {setup.days}, {setup.budget},{' '}
        {setup.time.toLowerCase()} a meal.{' '}
        <strong className="lb-avoids">
          <span className="lb-lead">Avoids</span>{' '}
          {setup.avoiding.length ? setup.avoiding.join(', ') : 'no allergens'}.
        </strong>
        {setup.diets.length ? ` ${setup.diets.join(', ')}.` : ''}
      </p>
      <button type="button" className="lb-button" onClick={() => m.setView('setup')}>
        Edit setup
      </button>
    </div>
  )
}

function Notes({ m }) {
  return (
    <>
      {m.warnings.map((warning) => (
        <p key={warning} className="lb-note lb-note--warn" role="status">
          <Alert />
          <span>
            <strong>Heads up.</strong> {warning}
          </span>
        </p>
      ))}
      {m.note ? (
        <p className="lb-note" role="status">
          <Check />
          <span>
            <strong>What changed.</strong> {m.note.text}
          </span>
          {m.note.undo ? (
            <button type="button" className="lb-button lb-button--small" onClick={m.note.undo.run}>
              <Undo size={14} /> {m.note.undo.label}
            </button>
          ) : null}
          <button type="button" className="lb-text-button" onClick={m.dismissNote}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  )
}

function CheckCell({ day }) {
  if (day.status === 'empty') return <span className="lb-check lb-check--empty">Nothing planned</span>
  return (
    <>
      {day.status === 'problem' ? (
        <span className="lb-check lb-check--bad">
          <Alert size={14} /> {day.issues.join('; ')}
        </span>
      ) : (
        <span className="lb-check lb-check--ok">
          <Check size={14} /> OK
        </span>
      )}
      {day.notes.length ? <span className="lb-check-note">{day.notes.join(', ')}</span> : null}
    </>
  )
}

function WeekTable({ m }) {
  const goals = PREFS.nutritionGoals
  return (
    <div className="lb-table-wrap">
      <table className="lb-table">
        <caption className="lb-vh">
          Meals for each day of week {m.week + 1}, with each day’s figures against your goals
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {MEAL_SLOTS.map((slot) => (
              <th key={slot} scope="col">
                {SLOT_LABELS[slot]}
              </th>
            ))}
            <th scope="col" className="lb-num">
              Per person
            </th>
            <th scope="col" className="lb-num">
              % goal
            </th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {m.days.map((day) => (
            <tr key={day.name} data-status={day.status}>
              <th scope="row">{day.name}</th>
              {day.slots.map((cell) => {
                const on = m.selected?.day === cell.day && m.selected?.slotIndex === cell.slotIndex
                return (
                  <td key={cell.slotIndex} className="lb-meal" data-selected={on ? '' : undefined} data-label={SLOT_LABELS[cell.mealType]}>
                    <MealSelect m={m} day={cell.day} slotIndex={cell.slotIndex} label={cell.label} className="lb-select" />
                    {cell.recipe ? (
                      <span className="lb-meal-meta">
                        <span>
                          {cell.problems.length ? (
                            <strong className="lb-flag">{cell.problems[0].message}</strong>
                          ) : (
                            mealMeta(cell.recipe)
                          )}
                          {cell.slot.servings ? ` · for ${cell.slot.servings}` : ''}
                        </span>
                        <button
                          type="button"
                          className="lb-text-button"
                          aria-expanded={on}
                          onClick={() => (on ? m.close() : m.select(cell.day, cell.slotIndex))}
                        >
                          Recipe<span className="lb-vh"> for {cell.label}</span>
                        </button>
                      </span>
                    ) : null}
                  </td>
                )
              })}
              <td className="lb-num lb-figs" data-label="Per person">
                {day.filled ? (
                  <>
                    <span>{kcal(day.calories)} kcal</span>
                    <span>{grams(day.protein)} g protein</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="lb-num lb-figs lb-strong" data-label="% goal">
                {day.filled ? (
                  <>
                    <span>{percent(day.calories, goals.calories)}%</span>
                    <span>{percent(day.protein, goals.protein)}%</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="lb-checkcell" data-label="Check">
                <CheckCell day={day} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The signature: the week's figures as a facts panel, percent of goal and all.
function WeekFacts({ m }) {
  const s = m.summary
  const rows = [
    ['Calories', s.plannedDays ? kcal(s.calories) : '—', percent(s.calories, s.calorieGoal)],
    ['Protein', s.plannedDays ? `${s.protein} g` : '—', percent(s.protein, s.proteinGoal)],
    ['Carbs', s.plannedDays ? `${s.carbs} g` : '—', null],
    ['Fat', s.plannedDays ? `${s.fat} g` : '—', null],
  ]
  return (
    <section className="lb-facts" aria-labelledby="lb-facts-title">
      <h2 id="lb-facts-title" className="lb-facts-title">
        Week {m.week + 1} facts
      </h2>
      <p className="lb-facts-line">
        {s.plannedDays} of 7 days planned, {s.filledSlots} of {s.totalSlots} meals
      </p>
      <div className="lb-rule lb-rule--heavy" />
      <p className="lb-facts-head">
        <span>Per person, per day</span>
        <span>% of goal*</span>
      </p>
      <dl className="lb-facts-rows">
        {rows.map(([name, value, share], index) => (
          <div key={name} className={index === 0 ? 'lb-facts-row lb-facts-row--lead' : 'lb-facts-row'}>
            <dt>{name}</dt>
            <dd>{value}</dd>
            <dd className="lb-strong">{share == null || !s.plannedDays ? '' : `${share}%`}</dd>
          </div>
        ))}
      </dl>
      <div className="lb-rule lb-rule--medium" />
      <p className="lb-facts-fix" data-bad={s.problemDays.length ? '' : undefined}>
        <span>Days needing a fix</span>
        <strong>{s.problemDays.length}</strong>
      </p>
      <p className="lb-fine">
        {s.problemDays.length ? `${s.problemDays.join(', ')}.` : 'Every planned day checks out.'}
      </p>
      <div className="lb-rule" />
      <p className="lb-fine">
        * Your goals are {kcal(s.calorieGoal)} kcal and {s.proteinGoal} g protein a day. Figures are
        estimated from the recipes’ own numbers.
      </p>
    </section>
  )
}

function RecipeLabel({ m, panel }) {
  const d = m.detail
  const { recipe, slot } = d
  const nutrition = recipe.nutritionPerServing
  const own = isOwn(recipe)
  const at = [d.day, d.slotIndex]
  const perServingCost = recipe.ingredients.reduce((sum, item) => sum + (item.cost ?? 0), 0)

  return (
    <section className="lb-recipe" role="dialog" aria-label={recipe.name} tabIndex={-1} ref={panel}>
      <div className="lb-recipe-bar">
        <h2 className="lb-recipe-title">{slot.leftover ? `Leftovers: ${recipe.name}` : recipe.name}</h2>
        <button type="button" className="lb-button lb-button--icon" onClick={m.close} aria-label="Close recipe">
          <Close />
        </button>
      </div>
      <p className="lb-fine">
        {SLOT_LABELS[d.mealType]}, {d.dayName} of Week {m.week + 1}, {d.servings}{' '}
        {d.servings === 1 ? 'serving' : 'servings'}
        {slot.leftover ? ', reheated from an earlier meal' : ''}
      </p>

      {d.problems.length ? (
        <p className="lb-alert" role="alert">
          <Alert />
          <span>
            <strong>Do not cook this as planned.</strong> {d.problems.map((p) => p.message).join('. ')}.
            Swap it for one of the alternatives below.
          </span>
        </p>
      ) : null}

      <div className="lb-recipe-actions">
        <button
          type="button"
          className="lb-button lb-button--primary"
          disabled={slot.status === MEAL_STATUS.ACCEPTED}
          onClick={() => m.accept(...at)}
        >
          {slot.status === MEAL_STATUS.ACCEPTED ? 'Accepted' : 'Accept this meal'}
        </button>
        <button type="button" className="lb-button" disabled={slot.status === MEAL_STATUS.REJECTED} onClick={() => m.reject(...at)}>
          {slot.status === MEAL_STATUS.REJECTED ? 'Rejected' : 'Reject'}
        </button>
        <button type="button" className="lb-button" aria-pressed={slot.saved} onClick={() => m.toggleSaved(...at)}>
          {slot.saved ? 'Saved' : 'Save this recipe'}
        </button>
        <button type="button" className="lb-button" onClick={() => m.suggestAnother(...at)}>
          Suggest another
        </button>
        {own ? (
          <button type="button" className="lb-button">
            Edit this recipe
          </button>
        ) : null}
      </div>

      <label className="lb-field" htmlFor="lb-people">
        <span>People for this meal</span>
        <PeopleInput m={m} detail={d} id="lb-people" className="lb-input" />
        <span className="lb-fine">Leave blank to use your household of {PREFS.householdSize}.</span>
      </label>

      {recipe.imageUrl ? <img className="lb-photo" src={recipe.imageUrl} alt="" loading="lazy" /> : null}

      <div className="lb-facts lb-facts--recipe">
        <h3 className="lb-facts-title">{nutritionHeading(recipe)}</h3>
        <div className="lb-rule lb-rule--heavy" />
        {nutrition ? (
          <dl className="lb-facts-rows">
            <div className="lb-facts-row lb-facts-row--lead">
              <dt>Calories</dt>
              <dd>{kcal(nutrition.calories)}</dd>
            </div>
            <div className="lb-facts-row">
              <dt>Protein</dt>
              <dd>{grams(nutrition.protein)} g</dd>
            </div>
            <div className="lb-facts-row">
              <dt>Carbs</dt>
              <dd>{grams(nutrition.carbs)} g</dd>
            </div>
            <div className="lb-facts-row">
              <dt>Fat</dt>
              <dd>{grams(nutrition.fat)} g</dd>
            </div>
          </dl>
        ) : (
          <p>The recipe gives no nutrition figures.</p>
        )}
        <div className="lb-rule lb-rule--medium" />
        <p className="lb-fine">Source: {recipe.nutritionSource}.</p>
      </div>

      <p className="lb-ingredients">
        <span className="lb-lead">Ingredients</span>{' '}
        {own
          ? recipe.ingredients
              .map((item) => `${item.name} (${Math.round(item.quantity * d.servings * 100) / 100} ${item.unit})`)
              .join(', ')
          : recipe.ingredients.map((item) => item.name).join(', ')}
        .
      </p>
      {recipe.allergens.length || d.conflicts.length ? (
        <p className="lb-ingredients" data-bad={d.conflicts.length ? '' : undefined}>
          <strong>
            <span className="lb-lead">Contains</span> {[...new Set([...recipe.allergens, ...d.conflicts])].join(', ')}.
          </strong>
          {d.conflicts.length ? ` This conflicts with ${d.conflicts.join(', ')} in your setup.` : ''}
        </p>
      ) : null}
      <p className="lb-fine">
        {own
          ? `About $${(perServingCost * d.servings).toFixed(2)} for ${d.servings} servings, from the prices you entered.`
          : 'The recipe gives no amounts or prices, so none are shown.'}
      </p>

      <h3 className="lb-h3">
        Directions{recipe.cookTimeMinutes == null ? '' : `, about ${recipe.cookTimeMinutes} min`}
      </h3>
      <ol className="lb-steps">
        {recipe.instructions.map((step, index) => (
          <li key={`${index}-${step}`}>{step}</li>
        ))}
      </ol>

      <h3 className="lb-h3">Alternatives that fit your setup</h3>
      {d.alternatives.length ? (
        <ul className="lb-alts">
          {d.alternatives.map((option) => (
            <li key={option.name}>
              <span>
                <strong>{option.name}</strong>
                <span className="lb-fine">{mealMeta(option)} per serving</span>
              </span>
              <button type="button" className="lb-button lb-button--small" onClick={() => m.useAlternative(d.day, d.slotIndex, option.name)}>
                Use this
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lb-fine">
          No other {d.mealType} option fits your allergies and diet. Remake the plan for new ones.
        </p>
      )}

      <p className="lb-fine">{recipeNote(recipe)} Check the product labels yourself before cooking.</p>
    </section>
  )
}

export function Label() {
  const m = usePlanModel()
  const theme = useTheme()
  const open = Boolean(m.detail?.recipe)
  const panel = useRecipeFocus(open, m.close)

  return (
    <div className="lb" data-theme={theme.resolved}>
      <Band m={m} theme={theme} />
      {m.view !== 'plan' ? (
        <main className="lb-main lb-main--single">
          <h1 className="lb-h1">{STEP_NAMES[m.view]}</h1>
          <p>This prototype covers the Plan step. {STEP_NAMES[m.view]} is rebuilt in this direction once it is chosen.</p>
          <button type="button" className="lb-button lb-button--primary" onClick={() => m.setView('plan')}>
            Back to the plan
          </button>
        </main>
      ) : (
        <>
          <Statement m={m} />
          <main className="lb-main" data-detail={open ? '' : undefined}>
            <section className="lb-week" aria-labelledby="lb-title">
              <div className="lb-head">
                <h1 className="lb-h1" id="lb-title">
                  Your meal plan
                </h1>
                <div className="lb-weeks" role="tablist" aria-label="Weeks">
                  {[0, 1].map((index) => (
                    <button
                      key={index}
                      type="button"
                      role="tab"
                      className="lb-week-tab"
                      aria-selected={m.week === index}
                      onClick={() => m.setWeek(index)}
                    >
                      Week {index + 1}
                      <span>{m.weekNote(index)}</span>
                    </button>
                  ))}
                </div>
                <div className="lb-actions">
                  <button type="button" className="lb-button" disabled={m.loading} onClick={m.remake}>
                    {m.loading ? 'Remaking your plan…' : 'Remake the plan'}
                  </button>
                  <button type="button" className="lb-button" disabled={m.loading} onClick={m.clearWeek}>
                    Clear this week
                  </button>
                  <button type="button" className="lb-button">
                    Add your own recipe
                  </button>
                </div>
              </div>

              <Notes m={m} />

              {m.loading ? (
                <div className="lb-loading" role="status" aria-live="polite">
                  <p className="lb-loading-title">Building your plan</p>
                  <div className="lb-loading-rule" aria-hidden="true" />
                  <p>{PLAN_BUILDING}</p>
                </div>
              ) : m.empty ? (
                <div className="lb-empty">
                  <h2 className="lb-h2">Nothing planned for this week</h2>
                  <p>
                    The planner chooses meals for the {PREFS.planningPeriod} days of your planning period. For a
                    longer plan, change the planning period in Setup and build it again.
                  </p>
                  <button type="button" className="lb-button lb-button--primary" onClick={() => m.setView('setup')}>
                    Edit setup
                  </button>
                </div>
              ) : (
                <>
                  <WeekTable m={m} />
                  <div className="lb-confirm">
                    <div>
                      <h2 className="lb-h2">{m.confirmed ? 'This week is confirmed' : 'Happy with this week?'}</h2>
                      <p>
                        {m.confirmed
                          ? 'Your grocery list is built from these meals. Change a meal and it updates.'
                          : 'Confirm it to turn these meals into a grocery list the buying agent can shop for.'}
                      </p>
                      {m.summary.problemDays.length ? (
                        <p className="lb-check lb-check--bad">
                          <Alert size={14} /> Fix the days marked in the Check column before confirming:{' '}
                          {m.summary.problemDays.join(', ')}.
                        </p>
                      ) : null}
                    </div>
                    <div className="lb-confirm-actions">
                      <button
                        type="button"
                        className="lb-button lb-button--primary lb-button--large"
                        disabled={Boolean(m.summary.problemDays.length)}
                        onClick={m.confirmWeek}
                      >
                        {m.confirmed ? 'Re-confirm this week' : 'Confirm this week'}
                      </button>
                      {m.confirmed ? (
                        <button type="button" className="lb-button lb-button--large" onClick={() => m.setView('grocery')}>
                          Go to grocery list
                        </button>
                      ) : null}
                    </div>
                  </div>
                </>
              )}

              <details className="lb-how">
                <summary>How this page works</summary>
                <ul>
                  {HOW_TO.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            </section>

            <aside className="lb-side" aria-label={open ? 'Recipe' : 'This week’s figures'}>
              {open ? <RecipeLabel m={m} panel={panel} /> : <WeekFacts m={m} />}
            </aside>
          </main>
        </>
      )}
      <footer className="lb-foot" aria-label="Safety information">
        <p>
          <span className="lb-lead">Check this before you cook</span> {SAFETY.join(' ')}
        </p>
      </footer>
    </div>
  )
}
