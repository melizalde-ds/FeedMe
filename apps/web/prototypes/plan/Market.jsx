// Direction 2, "Market": the colour of produce labels. A cobalt rail, a week
// laid out as seven day columns, and the oval sticker as the one mark that
// says what a meal is: checked, yours, leftovers, or not safe.
import './market.css'
import { Alert, Arrow, Check, Close, Plus, Star, ThemeIcon, Undo } from './icons.jsx'
import {
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

function Sticker({ kind, children }) {
  return (
    <span className="mk-sticker" data-kind={kind}>
      {children}
    </span>
  )
}

// What a meal's sticker says. A meal with nothing to say gets none.
function stickerFor(cell) {
  if (cell.problems.length) return { kind: 'bad', text: cell.problems[0].message, icon: <Alert size={13} /> }
  if (cell.slot.status === MEAL_STATUS.REJECTED) return { kind: 'quiet', text: 'Rejected' }
  if (cell.slot.leftover) return { kind: 'lemon', text: 'Leftovers' }
  if (isOwn(cell.recipe)) return { kind: 'cobalt', text: 'Yours' }
  if (cell.slot.status === MEAL_STATUS.ACCEPTED) return { kind: 'leaf', text: 'Accepted', icon: <Check size={13} /> }
  return null
}

function Rail({ m, theme }) {
  return (
    <aside className="mk-rail">
      <p className="mk-word">FeedMe</p>
      <nav className="mk-nav" aria-label="Main">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            className="mk-step"
            aria-current={m.view === step ? 'page' : undefined}
            onClick={() => m.setView(step)}
          >
            <span>{STEP_NAMES[step]}</span>
            {step === 'grocery' && !m.groceryReady ? <small>confirm a week first</small> : null}
          </button>
        ))}
      </nav>
      <div className="mk-rail-foot">
        <span className="mk-email" title={ACCOUNT_EMAIL}>
          {ACCOUNT_EMAIL}
        </span>
        <div className="mk-rail-buttons">
          <button type="button" className="mk-rail-button">
            Sign out
          </button>
          <button
            type="button"
            className="mk-rail-button mk-rail-icon"
            aria-label={theme.label}
            title={theme.label}
            onClick={theme.cycle}
          >
            <ThemeIcon choice={theme.choice} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Tile({ m, cell }) {
  const sticker = cell.recipe ? stickerFor(cell) : null
  const on = m.selected?.day === cell.day && m.selected?.slotIndex === cell.slotIndex

  if (!cell.recipe) {
    return (
      <button
        type="button"
        className="mk-tile mk-tile--empty"
        data-meal={cell.mealType}
        aria-label={`Choose a meal for ${cell.label}`}
        onClick={() => m.select(cell.day, cell.slotIndex)}
      >
        <span className="mk-tile-type">{SLOT_LABELS[cell.mealType]}</span>
        <span className="mk-tile-add">
          <Plus size={14} /> Choose a meal
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className="mk-tile"
      data-meal={cell.mealType}
      data-bad={cell.problems.length ? '' : undefined}
      data-on={on ? '' : undefined}
      aria-label={`${cell.label}: ${cell.slot.leftover ? 'leftovers of ' : ''}${cell.recipe.name}${
        cell.problems.length ? `. ${cell.problems[0].message}` : ''
      }. Open the recipe`}
      onClick={() => m.select(cell.day, cell.slotIndex)}
    >
      <span className="mk-tile-type">{SLOT_LABELS[cell.mealType]}</span>
      <span className="mk-tile-name">{cell.recipe.name}</span>
      <span className="mk-tile-meta">
        {mealMeta(cell.recipe)}
        {cell.slot.servings ? ` · for ${cell.slot.servings}` : ''}
      </span>
      {sticker ? (
        <Sticker kind={sticker.kind}>
          {sticker.icon}
          {sticker.text}
        </Sticker>
      ) : null}
      {cell.slot.saved ? (
        <span className="mk-tile-saved" title="Saved">
          <Star size={14} />
        </span>
      ) : null}
    </button>
  )
}

function Board({ m }) {
  return (
    <div className="mk-board">
      {m.days.map((day) => (
        <section key={day.name} className="mk-day" data-status={day.status} aria-labelledby={`mk-day-${day.index}`}>
          <header className="mk-day-head">
            <h2 id={`mk-day-${day.index}`}>{day.name}</h2>
            {day.status === 'ok' ? (
              <p className="mk-day-status" data-kind="ok">
                <Check size={14} /> OK
              </p>
            ) : day.status === 'problem' ? (
              <p className="mk-day-status" data-kind="bad">
                <Alert size={14} /> Needs a fix
              </p>
            ) : (
              <p className="mk-day-status">Nothing planned</p>
            )}
            {day.filled ? (
              <p className="mk-day-figs">
                {kcal(day.calories)} kcal · {grams(day.protein)} g protein
                {day.notes.length ? <span>{day.notes.join(', ')}</span> : null}
              </p>
            ) : null}
          </header>
          {day.slots.map((cell) => (
            <Tile key={cell.slotIndex} m={m} cell={cell} />
          ))}
        </section>
      ))}
    </div>
  )
}

function Meter({ value, goal, unit }) {
  const share = percent(value, goal) ?? 0
  return (
    <span className="mk-meter" role="img" aria-label={`${share}% of your ${goal}${unit} goal`}>
      <span style={{ inlineSize: `${Math.min(share, 100)}%` }} />
    </span>
  )
}

function Summary({ m }) {
  const s = m.summary
  return (
    <dl className="mk-summary">
      <div>
        <dt>Calories per person, per day</dt>
        <dd>
          <strong>{s.plannedDays ? kcal(s.calories) : '—'}</strong> of {kcal(s.calorieGoal)} kcal
        </dd>
        <Meter value={s.calories} goal={s.calorieGoal} unit=" kcal" />
      </div>
      <div>
        <dt>Protein per person, per day</dt>
        <dd>
          <strong>{s.plannedDays ? `${s.protein} g` : '—'}</strong> of {s.proteinGoal} g
        </dd>
        <Meter value={s.protein} goal={s.proteinGoal} unit=" g" />
      </div>
      <div>
        <dt>Carbs and fat per person, per day</dt>
        <dd>
          <strong>{s.plannedDays ? `${s.carbs} g · ${s.fat} g` : '—'}</strong>
        </dd>
        <p>Estimated from recipe macros</p>
      </div>
      <div>
        <dt>Days planned</dt>
        <dd>
          <strong>{s.plannedDays} of 7</strong> · {s.filledSlots} of {s.totalSlots} meals
        </dd>
        <p data-bad={s.problemDays.length ? '' : undefined}>
          {s.problemDays.length ? `Needs a fix: ${s.problemDays.join(', ')}` : 'Every planned day checks out'}
        </p>
      </div>
    </dl>
  )
}

function Drawer({ m, panel }) {
  const d = m.detail
  const { recipe, slot } = d
  const at = [d.day, d.slotIndex]
  const nutrition = recipe?.nutritionPerServing
  const own = isOwn(recipe)
  const title = !recipe ? `Choose a ${d.mealType}` : slot.leftover ? `Leftovers: ${recipe.name}` : recipe.name

  return (
    <div
      className="mk-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) m.close()
      }}
    >
      <section className="mk-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="mk-drawer-bar">
          <p className="mk-drawer-where" data-meal={d.mealType}>
            {SLOT_LABELS[d.mealType]} · {d.dayName} of Week {m.week + 1}
            {recipe ? ` · ${d.servings} ${d.servings === 1 ? 'serving' : 'servings'}` : ''}
          </p>
          <button type="button" className="mk-icon-button" onClick={m.close} aria-label="Close">
            <Close />
          </button>
        </div>
        <h2 className="mk-drawer-title">{title}</h2>

        {d.problems.length ? (
          <p className="mk-alert" role="alert">
            <Alert />
            <span>
              <strong>Do not cook this as planned.</strong> {d.problems.map((p) => p.message).join('. ')}. Swap it
              for one of the alternatives below.
            </span>
          </p>
        ) : null}

        {recipe?.imageUrl ? <img className="mk-photo" src={recipe.imageUrl} alt="" loading="lazy" /> : null}

        {recipe ? (
          <div className="mk-actions">
            <button
              type="button"
              className="mk-button mk-button--primary"
              disabled={slot.status === MEAL_STATUS.ACCEPTED}
              onClick={() => m.accept(...at)}
            >
              {slot.status === MEAL_STATUS.ACCEPTED ? 'Accepted' : 'Accept this meal'}
            </button>
            <button type="button" className="mk-button" disabled={slot.status === MEAL_STATUS.REJECTED} onClick={() => m.reject(...at)}>
              {slot.status === MEAL_STATUS.REJECTED ? 'Rejected' : 'Reject'}
            </button>
            <button type="button" className="mk-button" aria-pressed={slot.saved} onClick={() => m.toggleSaved(...at)}>
              {slot.saved ? 'Saved' : 'Save this recipe'}
            </button>
            <button type="button" className="mk-button" onClick={() => m.suggestAnother(...at)}>
              Suggest another
            </button>
            {own ? (
              <button type="button" className="mk-button">
                Edit this recipe
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mk-fields">
          <label htmlFor="mk-change">
            <span>{recipe ? 'Change this meal' : 'Meal'}</span>
            <MealSelect m={m} day={d.day} slotIndex={d.slotIndex} label={d.label} id="mk-change" className="mk-select" />
          </label>
          <label htmlFor="mk-people">
            <span>People</span>
            <PeopleInput m={m} detail={d} id="mk-people" className="mk-input" />
          </label>
        </div>
        <p className="mk-fine">Leave People blank to cook for your household of {PREFS.householdSize}.</p>

        {recipe ? (
          <>
            <h3 className="mk-h3">Alternatives that fit your setup</h3>
            {d.alternatives.length ? (
              <ul className="mk-alts">
                {d.alternatives.map((option) => (
                  <li key={option.name}>
                    <span>
                      <strong>{option.name}</strong>
                      <span className="mk-fine">{mealMeta(option)} per serving</span>
                    </span>
                    <button type="button" className="mk-button mk-button--small" onClick={() => m.useAlternative(d.day, d.slotIndex, option.name)}>
                      Use this
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mk-fine">
                No other {d.mealType} option fits your allergies and diet. Remake the plan for new ones.
              </p>
            )}

            <h3 className="mk-h3">{nutritionHeading(recipe)}</h3>
            {nutrition ? (
              <dl className="mk-macros">
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
            <p className="mk-fine">Source: {recipe.nutritionSource}.</p>

            <h3 className="mk-h3">Ingredients</h3>
            {recipe.allergens.length || d.conflicts.length ? (
              <p className="mk-contains" data-bad={d.conflicts.length ? '' : undefined}>
                <strong>Contains {[...new Set([...recipe.allergens, ...d.conflicts])].join(', ')}.</strong>
                {d.conflicts.length ? ` This conflicts with ${d.conflicts.join(', ')} in your setup.` : ''}
              </p>
            ) : null}
            <ul className="mk-ingredients">
              {recipe.ingredients.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  {item.name}
                  {own ? (
                    <span>
                      {Math.round(item.quantity * d.servings * 100) / 100} {item.unit} · $
                      {((item.cost ?? 0) * d.servings).toFixed(2)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {own ? null : <p className="mk-fine">The recipe gives no amounts or prices, so none are shown.</p>}

            <h3 className="mk-h3">
              Directions{recipe.cookTimeMinutes == null ? '' : ` · about ${recipe.cookTimeMinutes} min`}
            </h3>
            <ol className="mk-steps">
              {recipe.instructions.map((step, index) => (
                <li key={`${index}-${step}`}>{step}</li>
              ))}
            </ol>
            <p className="mk-fine mk-fine--end">{recipeNote(recipe)} Check the product labels yourself before cooking.</p>
          </>
        ) : null}
      </section>
    </div>
  )
}

export function Market() {
  const m = usePlanModel()
  const theme = useTheme()
  const panel = useRecipeFocus(Boolean(m.detail), m.close)
  const setup = setupSummary()

  return (
    <div className="mk" data-theme={theme.resolved}>
      <Rail m={m} theme={theme} />
      {m.view !== 'plan' ? (
        <main className="mk-main mk-main--single">
          <h1 className="mk-h1">{STEP_NAMES[m.view]}</h1>
          <p>This prototype covers the Plan step. {STEP_NAMES[m.view]} is rebuilt in this direction once it is chosen.</p>
          <button type="button" className="mk-button mk-button--primary" onClick={() => m.setView('plan')}>
            Back to the plan
          </button>
        </main>
      ) : (
        <main className="mk-main">
          <div className="mk-head">
            <h1 className="mk-h1">Your meal plan</h1>
            <div className="mk-weeks" role="tablist" aria-label="Weeks">
              {[0, 1].map((index) => (
                <button key={index} type="button" role="tab" aria-selected={m.week === index} onClick={() => m.setWeek(index)}>
                  Week {index + 1}
                  <small>{m.weekNote(index)}</small>
                </button>
              ))}
            </div>
            <div className="mk-head-actions">
              <button type="button" className="mk-button" disabled={m.loading} onClick={m.remake}>
                {m.loading ? 'Remaking your plan…' : 'Remake the plan'}
              </button>
              <button type="button" className="mk-button" disabled={m.loading} onClick={m.clearWeek}>
                Clear this week
              </button>
              <button type="button" className="mk-button">
                <Plus size={14} /> Add your own recipe
              </button>
            </div>
          </div>

          <ul className="mk-setup" aria-label="Your setup">
            <li>{setup.people}</li>
            <li>{setup.days}</li>
            <li>{setup.budget}</li>
            <li>{setup.time}</li>
            {setup.diets.map((diet) => (
              <li key={diet}>{diet}</li>
            ))}
            <li className="mk-setup-avoid">
              <Alert size={14} />
              {setup.avoiding.length ? `Avoiding ${setup.avoiding.join(', ')}` : 'No allergies'}
            </li>
            <li className="mk-setup-edit">
              <button type="button" className="mk-link" onClick={() => m.setView('setup')}>
                Edit setup
              </button>
            </li>
          </ul>

          {m.warnings.map((warning) => (
            <p key={warning} className="mk-note mk-note--warn" role="status">
              <Alert />
              <span>
                <strong>Heads up.</strong> {warning}
              </span>
            </p>
          ))}
          {m.note ? (
            <p className="mk-note" role="status">
              <Check />
              <span>
                <strong>What changed.</strong> {m.note.text}
              </span>
              {m.note.undo ? (
                <button type="button" className="mk-button mk-button--small" onClick={m.note.undo.run}>
                  <Undo size={14} /> {m.note.undo.label}
                </button>
              ) : null}
              <button type="button" className="mk-link" onClick={m.dismissNote}>
                Dismiss
              </button>
            </p>
          ) : null}

          {m.loading ? (
            <div className="mk-loading" role="status" aria-live="polite">
              <span className="mk-loading-mark" aria-hidden="true" />
              <div>
                <h2 className="mk-h2">Building your plan</h2>
                <p>{PLAN_BUILDING}</p>
              </div>
            </div>
          ) : m.empty ? (
            <div className="mk-empty">
              <h2 className="mk-h2">Nothing planned for this week</h2>
              <p>
                The planner chooses meals for the {PREFS.planningPeriod} days of your planning period. For a longer
                plan, change the planning period in Setup and build it again.
              </p>
              <button type="button" className="mk-button mk-button--primary" onClick={() => m.setView('setup')}>
                Edit setup
              </button>
            </div>
          ) : (
            <>
              <Summary m={m} />
              <Board m={m} />
              <div className="mk-confirm" data-confirmed={m.confirmed ? '' : undefined}>
                <div>
                  <h2 className="mk-h2">{m.confirmed ? 'This week is confirmed' : 'Happy with this week?'}</h2>
                  <p>
                    {m.confirmed
                      ? 'Your grocery list is built from these meals. Change a meal and it updates.'
                      : 'Confirm it to turn these meals into a grocery list the buying agent can shop for.'}
                  </p>
                  {m.summary.problemDays.length ? (
                    <p className="mk-confirm-block">
                      <Alert size={14} /> Fix the days marked “Needs a fix” before confirming:{' '}
                      {m.summary.problemDays.join(', ')}.
                    </p>
                  ) : null}
                </div>
                <div className="mk-confirm-actions">
                  <button
                    type="button"
                    className="mk-button mk-button--lemon mk-button--large"
                    disabled={Boolean(m.summary.problemDays.length)}
                    onClick={m.confirmWeek}
                  >
                    {m.confirmed ? 'Re-confirm this week' : 'Confirm this week'}
                  </button>
                  {m.confirmed ? (
                    <button type="button" className="mk-button mk-button--onblue mk-button--large" onClick={() => m.setView('grocery')}>
                      Go to grocery list <Arrow size={16} />
                    </button>
                  ) : null}
                </div>
                {m.confirmed ? (
                  <span className="mk-seal" aria-hidden="true">
                    <Check size={22} />
                    Week {m.week + 1}
                    <small>confirmed</small>
                  </span>
                ) : null}
              </div>
            </>
          )}

          <details className="mk-how">
            <summary>How this page works</summary>
            <ul>
              {HOW_TO.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>

          <aside className="mk-safety" aria-label="Safety information">
            <h2 className="mk-h3">Check this before you cook</h2>
            <ul>
              {SAFETY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </aside>
        </main>
      )}
      {m.detail && m.view === 'plan' ? <Drawer m={m} panel={panel} /> : null}
    </div>
  )
}
