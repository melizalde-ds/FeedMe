// Direction 3, "Wall": the week as three rails of recipe photographs, one
// per meal. The tile you point at grows and says what it is while the rest of
// the wall steps back, and opening one unfolds its recipe under that rail.
import { useEffect, useRef } from 'react'
import './wall.css'
import { Alert, Check, Close, Plus, Star, ThemeIcon, Undo } from './icons.jsx'
import {
  MEAL_SLOTS,
  MEAL_STATUS,
  PREFS,
  SLOT_LABELS,
  grams,
  isOwn,
  kcal,
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
const SHORT_DAY = (name) => name.slice(0, 3)

function flagFor(cell) {
  if (cell.problems.length) return { kind: 'bad', text: cell.problems[0].message, icon: <Alert size={13} /> }
  if (cell.slot.status === MEAL_STATUS.REJECTED) return { kind: 'quiet', text: 'Rejected' }
  if (cell.slot.leftover) return { kind: 'plain', text: 'Leftovers' }
  if (isOwn(cell.recipe)) return { kind: 'plain', text: 'Yours' }
  if (cell.slot.status === MEAL_STATUS.ACCEPTED) return { kind: 'ok', text: 'Accepted', icon: <Check size={13} /> }
  return null
}

function Tile({ m, cell, dayName }) {
  const on = m.selected?.day === cell.day && m.selected?.slotIndex === cell.slotIndex
  const open = () => (on ? m.close() : m.select(cell.day, cell.slotIndex))

  if (!cell.recipe) {
    return (
      <button
        type="button"
        className="wl-tile wl-tile--empty"
        aria-label={`Choose a meal for ${cell.label}`}
        aria-expanded={on}
        data-on={on ? '' : undefined}
        onClick={open}
      >
        <span className="wl-tile-day">{SHORT_DAY(dayName)}</span>
        <span className="wl-tile-add">
          <Plus size={16} /> Choose a meal
        </span>
      </button>
    )
  }

  const flag = flagFor(cell)
  const nutrition = cell.recipe.nutritionPerServing
  return (
    <button
      type="button"
      className="wl-tile"
      data-on={on ? '' : undefined}
      data-bad={cell.problems.length ? '' : undefined}
      data-leftover={cell.slot.leftover ? '' : undefined}
      data-rejected={cell.slot.status === MEAL_STATUS.REJECTED ? '' : undefined}
      aria-expanded={on}
      aria-label={`${cell.label}: ${cell.slot.leftover ? 'leftovers of ' : ''}${cell.recipe.name}${
        cell.problems.length ? `. ${cell.problems[0].message}` : ''
      }`}
      onClick={open}
    >
      {cell.recipe.imageUrl ? (
        <img className="wl-tile-photo" src={cell.recipe.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="wl-tile-photo wl-tile-photo--none" aria-hidden="true" />
      )}
      <span className="wl-tile-top">
        <span className="wl-tile-day">{SHORT_DAY(dayName)}</span>
        {flag ? (
          <span className="wl-flag" data-kind={flag.kind}>
            {flag.icon}
            {flag.text}
          </span>
        ) : null}
        {cell.slot.saved ? (
          <span className="wl-flag" data-kind="plain" title="Saved">
            <Star size={13} />
          </span>
        ) : null}
      </span>
      <span className="wl-tile-body">
        <span className="wl-tile-name">{cell.recipe.name}</span>
        <span className="wl-tile-more">
          {mealMeta(cell.recipe)}
          {nutrition?.protein == null ? '' : ` · ${grams(nutrition.protein)} g protein`}
          {cell.slot.servings ? ` · for ${cell.slot.servings}` : ''}
        </span>
      </span>
    </button>
  )
}

// The recipe, unfolded under the rail it belongs to.
function Shelf({ m, panel }) {
  const d = m.detail
  const { recipe, slot } = d
  const at = [d.day, d.slotIndex]
  const nutrition = recipe?.nutritionPerServing
  const own = isOwn(recipe)
  const title = !recipe ? `Choose a ${d.mealType}` : slot.leftover ? `Leftovers: ${recipe.name}` : recipe.name
  const shelf = useRef(null)

  useEffect(() => {
    shelf.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [d.day, d.slotIndex])

  return (
    <div className="wl-shelf" ref={shelf}>
      <section className="wl-shelf-in" role="region" aria-label={title} tabIndex={-1} ref={panel}>
        {recipe?.imageUrl ? <img className="wl-shelf-photo" src={recipe.imageUrl} alt="" /> : null}

        <div className="wl-shelf-main">
          <div className="wl-shelf-bar">
            <p className="wl-where">
              {SLOT_LABELS[d.mealType]} · {d.dayName} of Week {m.week + 1}
              {recipe ? ` · ${d.servings} ${d.servings === 1 ? 'serving' : 'servings'}` : ''}
              {slot.leftover ? ' · reheated from an earlier meal' : ''}
            </p>
            <button type="button" className="wl-icon-button" onClick={m.close} aria-label="Close recipe">
              <Close />
            </button>
          </div>
          <h3 className="wl-shelf-title">{title}</h3>

          {d.problems.length ? (
            <p className="wl-alert" role="alert">
              <Alert />
              <span>
                <strong>Do not cook this as planned.</strong> {d.problems.map((p) => p.message).join('. ')}. Swap it
                for one of the alternatives.
              </span>
            </p>
          ) : null}

          {recipe ? (
            <div className="wl-actions">
              <button
                type="button"
                className="wl-button wl-button--primary"
                disabled={slot.status === MEAL_STATUS.ACCEPTED}
                onClick={() => m.accept(...at)}
              >
                {slot.status === MEAL_STATUS.ACCEPTED ? 'Accepted' : 'Accept this meal'}
              </button>
              <button type="button" className="wl-button" disabled={slot.status === MEAL_STATUS.REJECTED} onClick={() => m.reject(...at)}>
                {slot.status === MEAL_STATUS.REJECTED ? 'Rejected' : 'Reject'}
              </button>
              <button type="button" className="wl-button" aria-pressed={slot.saved} onClick={() => m.toggleSaved(...at)}>
                {slot.saved ? 'Saved' : 'Save this recipe'}
              </button>
              <button type="button" className="wl-button" onClick={() => m.suggestAnother(...at)}>
                Suggest another
              </button>
              {own ? (
                <button type="button" className="wl-button">
                  Edit this recipe
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="wl-fields">
            <label htmlFor="wl-change">
              <span>{recipe ? 'Change this meal' : 'Meal'}</span>
              <MealSelect m={m} day={d.day} slotIndex={d.slotIndex} label={d.label} id="wl-change" className="wl-select" />
            </label>
            <label htmlFor="wl-people">
              <span>People</span>
              <PeopleInput m={m} detail={d} id="wl-people" className="wl-input" />
            </label>
          </div>
          <p className="wl-fine">Leave People blank to cook for your household of {PREFS.householdSize}.</p>

          {recipe ? (
            <>
              <h4 className="wl-h4">{nutritionHeading(recipe)}</h4>
              {nutrition ? (
                <dl className="wl-macros">
                  <div>
                    <dd>{kcal(nutrition.calories)}</dd>
                    <dt>kcal</dt>
                  </div>
                  <div>
                    <dd>{grams(nutrition.protein)} g</dd>
                    <dt>protein</dt>
                  </div>
                  <div>
                    <dd>{grams(nutrition.carbs)} g</dd>
                    <dt>carbs</dt>
                  </div>
                  <div>
                    <dd>{grams(nutrition.fat)} g</dd>
                    <dt>fat</dt>
                  </div>
                </dl>
              ) : (
                <p>The recipe gives no nutrition figures.</p>
              )}
              <p className="wl-fine">Source: {recipe.nutritionSource}.</p>

              <h4 className="wl-h4">Ingredients</h4>
              {recipe.allergens.length || d.conflicts.length ? (
                <p className="wl-contains" data-bad={d.conflicts.length ? '' : undefined}>
                  <strong>Contains {[...new Set([...recipe.allergens, ...d.conflicts])].join(', ')}.</strong>
                  {d.conflicts.length ? ` This conflicts with ${d.conflicts.join(', ')} in your setup.` : ''}
                </p>
              ) : null}
              <ul className="wl-ingredients">
                {recipe.ingredients.map((item, index) => (
                  <li key={`${item.name}-${index}`}>
                    {item.name}
                    {own ? (
                      <span>
                        {' '}
                        {Math.round(item.quantity * d.servings * 100) / 100} {item.unit} · $
                        {((item.cost ?? 0) * d.servings).toFixed(2)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {own ? null : <p className="wl-fine">The recipe gives no amounts or prices, so none are shown.</p>}

              <h4 className="wl-h4">
                Directions{recipe.cookTimeMinutes == null ? '' : ` · about ${recipe.cookTimeMinutes} min`}
              </h4>
              <ol className="wl-steps">
                {recipe.instructions.map((step, index) => (
                  <li key={`${index}-${step}`}>{step}</li>
                ))}
              </ol>
              <p className="wl-fine">{recipeNote(recipe)} Check the product labels yourself before cooking.</p>
            </>
          ) : null}
        </div>

        {recipe ? (
          <div className="wl-shelf-alts">
            <h4 className="wl-h4">Alternatives that fit your setup</h4>
            {d.alternatives.length ? (
              <ul>
                {d.alternatives.map((option) => (
                  <li key={option.name}>
                    {option.imageUrl ? (
                      <img src={option.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="wl-tile-photo--none" aria-hidden="true" />
                    )}
                    <span>
                      <strong>{option.name}</strong>
                      <span className="wl-fine">{mealMeta(option)} per serving</span>
                      <button type="button" className="wl-button wl-button--small" onClick={() => m.useAlternative(d.day, d.slotIndex, option.name)}>
                        Use this
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wl-fine">
                No other {d.mealType} option fits your allergies and diet. Remake the plan for new ones.
              </p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function Summary({ m }) {
  const s = m.summary
  return (
    <dl className="wl-summary">
      <div>
        <dt>Calories</dt>
        <dd>
          <strong>{s.plannedDays ? kcal(s.calories) : '—'}</strong> of {kcal(s.calorieGoal)} kcal
        </dd>
      </div>
      <div>
        <dt>Protein</dt>
        <dd>
          <strong>{s.plannedDays ? `${s.protein} g` : '—'}</strong> of {s.proteinGoal} g
        </dd>
      </div>
      <div>
        <dt>Carbs and fat</dt>
        <dd>
          <strong>{s.plannedDays ? `${s.carbs} g · ${s.fat} g` : '—'}</strong>
        </dd>
      </div>
      <div>
        <dt>Days planned</dt>
        <dd>
          <strong>{s.plannedDays} of 7</strong> · {s.filledSlots} of {s.totalSlots} meals
        </dd>
      </div>
      <div data-bad={s.problemDays.length ? '' : undefined}>
        <dt>Days needing a fix</dt>
        <dd>
          <strong>{s.problemDays.length}</strong>{' '}
          {s.problemDays.length ? s.problemDays.join(', ') : 'Every planned day checks out'}
        </dd>
      </div>
    </dl>
  )
}

export function Wall() {
  const m = usePlanModel()
  const theme = useTheme()
  const panel = useRecipeFocus(Boolean(m.detail), m.close)
  const setup = setupSummary()

  return (
    <div className="wl" data-theme={theme.resolved}>
      <header className="wl-top">
        <p className="wl-word">FeedMe</p>
        <nav className="wl-nav" aria-label="Main">
          {STEPS.map((step) => (
            <button key={step} type="button" aria-current={m.view === step ? 'page' : undefined} onClick={() => m.setView(step)}>
              {STEP_NAMES[step]}
              {step === 'grocery' && !m.groceryReady ? <small>confirm a week first</small> : null}
            </button>
          ))}
        </nav>
        <div className="wl-account">
          <span className="wl-email" title={ACCOUNT_EMAIL}>
            {ACCOUNT_EMAIL}
          </span>
          <button type="button" className="wl-button wl-button--small">
            Sign out
          </button>
          <button type="button" className="wl-icon-button" aria-label={theme.label} title={theme.label} onClick={theme.cycle}>
            <ThemeIcon choice={theme.choice} />
          </button>
        </div>
      </header>

      {m.view !== 'plan' ? (
        <main className="wl-main wl-main--single">
          <h1 className="wl-h1">{STEP_NAMES[m.view]}</h1>
          <p>This prototype covers the Plan step. {STEP_NAMES[m.view]} is rebuilt in this direction once it is chosen.</p>
          <button type="button" className="wl-button wl-button--primary" onClick={() => m.setView('plan')}>
            Back to the plan
          </button>
        </main>
      ) : (
        <main className="wl-main">
          <div className="wl-head">
            <div>
              <h1 className="wl-h1">Your meal plan</h1>
              <p className="wl-setup">
                {setup.people} · {setup.days} · {setup.budget} · {setup.time}
                {setup.diets.length ? ` · ${setup.diets.join(', ')}` : ''} ·{' '}
                <strong>{setup.avoiding.length ? `Avoiding ${setup.avoiding.join(', ')}` : 'No allergies'}</strong>
                <button type="button" className="wl-link" onClick={() => m.setView('setup')}>
                  Edit setup
                </button>
              </p>
            </div>
            <div className="wl-head-side">
              <div className="wl-weeks" role="tablist" aria-label="Weeks">
                {[0, 1].map((index) => (
                  <button key={index} type="button" role="tab" aria-selected={m.week === index} onClick={() => m.setWeek(index)}>
                    Week {index + 1}
                    <small>{m.weekNote(index)}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="wl-button" disabled={m.loading} onClick={m.remake}>
                {m.loading ? 'Remaking your plan…' : 'Remake the plan'}
              </button>
              <button type="button" className="wl-button" disabled={m.loading} onClick={m.clearWeek}>
                Clear this week
              </button>
              <button type="button" className="wl-button">
                <Plus size={14} /> Add your own recipe
              </button>
            </div>
          </div>

          {m.warnings.map((warning) => (
            <p key={warning} className="wl-note" data-kind="warn" role="status">
              <Alert />
              <span>
                <strong>Heads up.</strong> {warning}
              </span>
            </p>
          ))}
          {m.note ? (
            <p className="wl-note" role="status">
              <Check />
              <span>
                <strong>What changed.</strong> {m.note.text}
              </span>
              {m.note.undo ? (
                <button type="button" className="wl-button wl-button--small" onClick={m.note.undo.run}>
                  <Undo size={14} /> {m.note.undo.label}
                </button>
              ) : null}
              <button type="button" className="wl-link" onClick={m.dismissNote}>
                Dismiss
              </button>
            </p>
          ) : null}

          {m.loading ? (
            <div className="wl-loading" role="status" aria-live="polite">
              <div>
                <h2 className="wl-h2">Building your plan</h2>
                <p>{PLAN_BUILDING}</p>
              </div>
              <div className="wl-loading-tiles" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => (
                  <span key={index} style={{ animationDelay: `${index * 120}ms` }} />
                ))}
              </div>
            </div>
          ) : m.empty ? (
            <div className="wl-empty">
              <h2 className="wl-h2">Nothing planned for this week</h2>
              <p>
                The planner chooses meals for the {PREFS.planningPeriod} days of your planning period. For a longer
                plan, change the planning period in Setup and build it again.
              </p>
              <button type="button" className="wl-button wl-button--primary" onClick={() => m.setView('setup')}>
                Edit setup
              </button>
            </div>
          ) : (
            <>
              <Summary m={m} />
              <div className="wl-wall">
                <section className="wl-rail wl-rail--days" aria-labelledby="wl-days">
                  <h2 id="wl-days" className="wl-rail-title">
                    Days
                  </h2>
                  <ul className="wl-tiles">
                    {m.days.map((day) => (
                      <li key={day.name} className="wl-day" data-status={day.status}>
                        <strong>{day.name}</strong>
                        {day.status === 'ok' ? (
                          <span className="wl-day-status">
                            <Check size={14} /> OK
                          </span>
                        ) : day.status === 'problem' ? (
                          <span className="wl-day-status">
                            <Alert size={14} /> {day.issues.join('; ')}
                          </span>
                        ) : (
                          <span className="wl-day-status">Nothing planned</span>
                        )}
                        {day.filled ? (
                          <span className="wl-day-figs">
                            {kcal(day.calories)} kcal · {grams(day.protein)} g protein
                            {day.notes.length ? <em>{day.notes.join(', ')}</em> : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>

                {MEAL_SLOTS.map((mealType, slotIndex) => (
                  <section key={mealType} className="wl-rail" aria-labelledby={`wl-rail-${mealType}`}>
                    <h2 id={`wl-rail-${mealType}`} className="wl-rail-title">
                      {SLOT_LABELS[mealType]}
                    </h2>
                    <ul className="wl-tiles">
                      {m.days.map((day) => (
                        <li key={day.name}>
                          <Tile m={m} cell={day.slots[slotIndex]} dayName={day.name} />
                        </li>
                      ))}
                    </ul>
                    {m.detail && m.selected.slotIndex === slotIndex ? <Shelf m={m} panel={panel} /> : null}
                  </section>
                ))}
              </div>

              <div className="wl-confirm">
                <div>
                  <h2 className="wl-h2">{m.confirmed ? 'This week is confirmed' : 'Happy with this week?'}</h2>
                  <p>
                    {m.confirmed
                      ? 'Your grocery list is built from these meals. Change a meal and it updates.'
                      : 'Confirm it to turn these meals into a grocery list the buying agent can shop for.'}
                  </p>
                  {m.summary.problemDays.length ? (
                    <p className="wl-confirm-block">
                      <Alert size={14} /> Fix the days marked above before confirming: {m.summary.problemDays.join(', ')}.
                    </p>
                  ) : null}
                </div>
                <div className="wl-confirm-actions">
                  <button
                    type="button"
                    className="wl-button wl-button--primary wl-button--large"
                    disabled={Boolean(m.summary.problemDays.length)}
                    onClick={m.confirmWeek}
                  >
                    {m.confirmed ? 'Re-confirm this week' : 'Confirm this week'}
                  </button>
                  {m.confirmed ? (
                    <button type="button" className="wl-button wl-button--large" onClick={() => m.setView('grocery')}>
                      Go to grocery list
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}

          <details className="wl-how">
            <summary>How this page works</summary>
            <ul>
              {HOW_TO.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>

          <aside className="wl-safety" aria-label="Safety information">
            <h2 className="wl-h4">Check this before you cook</h2>
            <ul>
              {SAFETY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </aside>
        </main>
      )}
    </div>
  )
}
