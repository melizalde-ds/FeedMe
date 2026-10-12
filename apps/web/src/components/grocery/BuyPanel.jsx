import { useState } from 'react'
import { SHOPPING_MODES, money, storeName } from '../../lib/shopping'
import { useShoppingRun } from '../../hooks/useShoppingRun'
import { Banner } from '../common/Banner'
import { LoadingState } from '../common/LoadingState'
import { Modal } from '../common/Modal'
import { CartTable } from './CartTable'
import { RunResult } from './RunResult'

const listOf = (items) => items.join(', ')

// Asked before a run, unless the user chose not to be asked. Every run ends
// in a payment request, so starting one is never a side effect of a click
// that says something else.
function ConfirmRun({ modeLabel, onConfirm, onCancel }) {
  const [remember, setRemember] = useState(false)

  return (
    <Modal title="Shop for these groceries?" onClose={onCancel}>
      <p className="m-0 mb-3 text-ink">
        The buying agent will fill a cart at the stores and then ask for{' '}
        <strong>one payment for the whole cart</strong>. It is a Stripe sandbox
        payment, so no real money moves, and it only goes through once it is
        approved in the Link app.
      </p>
      <p className="m-0 mb-4 text-mute">Shopping mode: {modeLabel}.</p>

      <label className="checkbox mb-5">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        <span>Do this every time, without asking me first</span>
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="button button--primary"
          onClick={() => onConfirm(remember)}
        >
          Yes, shop for them
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Not now
        </button>
      </div>
    </Modal>
  )
}

// A payment the run is waiting on. Whoever is signed in to Link on the
// machine running the server approves it.
function ApprovalNotice({ approval }) {
  return (
    <p className="alert alert--soft" role="status">
      <strong>
        Approve the payment of {money(approval.totalCents)} in the Link app.
      </strong>{' '}
      It covers {listOf(approval.stores.map(storeName))}, and the run waits up to
      ten minutes for it.
      {approval.url ? (
        <>
          {' '}
          <a href={approval.url} target="_blank" rel="noreferrer">
            Open the approval page
          </a>
          .
        </>
      ) : null}
    </p>
  )
}

// Requirement 5.5: the buying agent shops for the confirmed meals at the
// stores and pays with one payment. Card details never reach this app: the
// payment is approved in Stripe's Link app.
export function BuyPanel() {
  const {
    meals,
    ownRecipes,
    sameMeals,
    hasEarlierRun,
    canAuto,
    run,
    startError,
    autoBuy,
    start,
    askBeforeRuns,
    dismissStartError,
  } = useShoppingRun()

  const [chosenMode, setChosenMode] = useState('manual')
  const [asking, setAsking] = useState(false)

  // "Buy it for me" needs a budget to check against.
  const mode = chosenMode === 'auto' && !canAuto ? 'manual' : chosenMode
  const modeLabel = SHOPPING_MODES.find((option) => option.value === mode).label

  const running = run.phase === 'running'
  const finished = run.phase === 'done' || run.phase === 'failed'

  const begin = () => {
    // Null while the choice is still being read: ask, to be safe.
    if (autoBuy === true) start({ mode })
    else setAsking(true)
  }

  return (
    <section className="checkout" aria-labelledby="buy-title">
      <h2 id="buy-title" className="panel__title">
        Have the buying agent shop for this
      </h2>
      <p className="panel__lede">
        It compares prices across the stores, puts one pack of each ingredient
        in a cart, and asks for one payment at the end.
      </p>

      {ownRecipes.length ? (
        <p className="alert alert--soft">
          <strong>Not shopped for:</strong> {listOf(ownRecipes)}. The agent buys
          from the planner&rsquo;s recipes only, so buy the ingredients for your
          own recipes yourself.
        </p>
      ) : null}

      {meals.length ? (
        <>
          <fieldset className="fieldset" disabled={running}>
            <legend className="fieldset__legend">How should it shop?</legend>
            <div className="checkbox-grid checkbox-grid--single">
              {SHOPPING_MODES.map((option) => {
                const unavailable = option.value === 'auto' && !canAuto
                return (
                  <label key={option.value} className="checkbox items-start">
                    <input
                      type="radio"
                      name="shopping-mode"
                      value={option.value}
                      checked={mode === option.value}
                      disabled={unavailable}
                      onChange={() => setChosenMode(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <span className="block text-sm text-mute">
                        {option.detail}
                        {unavailable
                          ? ' Set a grocery budget in Setup to use this.'
                          : ''}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="field__hint">
              Either way the agent asks for the payment at the end of its run,
              for everything it picked. Approving that payment is the final
              check.
            </p>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="button button--primary button--large"
              disabled={running || run.phase === 'loading'}
              onClick={begin}
            >
              {running
                ? 'Shopping…'
                : hasEarlierRun && sameMeals
                  ? 'Shop for what is left'
                  : 'Shop for these groceries'}
            </button>

            {autoBuy ? (
              <p className="m-0 text-sm text-mute">
                Runs start without asking first.{' '}
                <button type="button" className="link-button" onClick={askBeforeRuns}>
                  Ask me first
                </button>
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="m-0 text-ink">
          Every confirmed meal is one of your own recipes, so there is nothing
          here for the agent to shop for.
        </p>
      )}

      {startError ? (
        <Banner
          variant="error"
          title="The agent could not do that"
          onDismiss={dismissStartError}
        >
          {startError}
        </Banner>
      ) : null}

      {hasEarlierRun && !sameMeals && !running ? (
        <p className="alert alert--soft">
          The confirmed meals have changed since the agent last shopped. What
          is below is from that earlier run; the next run shops for the meals as
          they are now, as a new order.
        </p>
      ) : null}

      {run.phase === 'loading' ? (
        <LoadingState label="Loading your last shopping run…" />
      ) : null}

      {running ? (
        <div className="mt-4 flex flex-col gap-3">
          <LoadingState label={run.status ?? 'Shopping…'} />
          {run.note ? <p className="alert alert--soft">{run.note}</p> : null}
          {run.error ? (
            <p className="alert" role="alert">
              {run.error}
            </p>
          ) : null}
          {run.approval ? <ApprovalNotice approval={run.approval} /> : null}
          <CartTable cart={run.cart} />
        </div>
      ) : null}

      {finished ? (
        <div className="mt-4">
          <RunResult />
        </div>
      ) : null}

      <p className="fine-print">
        The stores are FeedMe&rsquo;s demo stores and payment runs in
        Stripe&rsquo;s sandbox. Card details never reach this app or our
        backend.
      </p>

      {asking ? (
        <ConfirmRun
          modeLabel={modeLabel}
          onCancel={() => setAsking(false)}
          onConfirm={(remember) => {
            setAsking(false)
            start({ mode, remember })
          }}
        />
      ) : null}
    </section>
  )
}
