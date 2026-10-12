import { useState } from 'react'
import { SHOPPING_MODES, money, storeName } from '../../lib/shopping'
import { useShoppingRun } from '../../hooks/useShoppingRun'
import { Banner } from '../common/Banner'
import { LoadingState } from '../common/LoadingState'
import { Modal } from '../common/Modal'
import { Button, TextButton, linkClass } from '../ui/Button'
import { Choice, Hint } from '../ui/Field'
import { Cart } from '../ui/icons'
import { CartTable } from './CartTable'
import { RunResult } from './RunResult'

const listOf = (items) => items.join(', ')

// Asked before a run, unless the user chose not to be asked. Every run ends
// in a payment request, so starting one is never a side effect of a click
// that says something else.
function ConfirmRun({ modeLabel, onConfirm, onCancel }) {
  const [remember, setRemember] = useState(false)

  return (
    <Modal title="Shop for these groceries?" size="narrow" onClose={onCancel}>
      <p>
        The buying agent will fill a cart at the stores and then ask for{' '}
        <strong>one payment for the whole cart</strong>. It is a Stripe sandbox
        payment, so no real money moves, and it only goes through once it is
        approved in the Link app.
      </p>
      <p className="mt-3 text-mute">Shopping mode: {modeLabel}.</p>

      <Choice
        type="checkbox"
        className="mt-5"
        checked={remember}
        onChange={(event) => setRemember(event.target.checked)}
      >
        Do this every time, without asking me first
      </Choice>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onConfirm(remember)}>
          Yes, shop for them
        </Button>
        <Button onClick={onCancel}>Not now</Button>
      </div>
    </Modal>
  )
}

// A payment the run is waiting on. Whoever is signed in to Link on the
// machine running the server approves it.
function ApprovalNotice({ approval }) {
  return (
    <Banner variant="warning" compact>
      <strong>
        Approve the payment of {money(approval.totalCents)} in the Link app.
      </strong>{' '}
      It covers {listOf(approval.stores.map(storeName))}, and the run waits up to
      ten minutes for it.
      {approval.url ? (
        <>
          {' '}
          <a href={approval.url} target="_blank" rel="noreferrer" className={linkClass}>
            Open the approval page
          </a>
          .
        </>
      ) : null}
    </Banner>
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
    <section className="min-w-0" aria-labelledby="buy-title">
      <h2 id="buy-title" className="text-xl font-bold tracking-tight">
        Have the buying agent shop for this
      </h2>
      <p className="mt-1 max-w-[56ch] text-mute">
        It compares prices across the stores, puts one pack of each ingredient
        in a cart, and asks for one payment at the end.
      </p>

      <div className="mt-5 flex min-w-0 flex-col gap-5">
        {ownRecipes.length ? (
          <Banner variant="warning" compact>
            <strong>Not shopped for:</strong> {listOf(ownRecipes)}. The agent buys
            from the planner&rsquo;s recipes only, so buy the ingredients for your
            own recipes yourself.
          </Banner>
        ) : null}

        {meals.length ? (
          <>
            <fieldset className="min-w-0" disabled={running}>
              <legend className="float-left mb-3 w-full text-base font-bold">How should it shop?</legend>
              <div className="clear-both grid gap-3 sm:grid-cols-2">
                {SHOPPING_MODES.map((option) => {
                  const unavailable = option.value === 'auto' && !canAuto
                  return (
                    <Choice
                      key={option.value}
                      type="radio"
                      name="shopping-mode"
                      value={option.value}
                      checked={mode === option.value}
                      disabled={unavailable}
                      onChange={() => setChosenMode(option.value)}
                    >
                      <strong>{option.label}</strong>
                      <span className="block text-sm text-mute">
                        {option.detail}
                        {unavailable
                          ? ' Set a grocery budget in Setup to use this.'
                          : ''}
                      </span>
                    </Choice>
                  )
                })}
              </div>
              <Hint className="mt-3 max-w-[56ch]">
                Either way the agent asks for the payment at the end of its run,
                for everything it picked. Approving that payment is the final
                check.
              </Hint>
            </fieldset>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button
                variant="primary"
                size="lg"
                disabled={running || run.phase === 'loading'}
                onClick={begin}
              >
                {running ? null : <Cart size={18} />}
                {running
                  ? 'Shopping…'
                  : hasEarlierRun && sameMeals
                    ? 'Shop for what is left'
                    : 'Shop for these groceries'}
              </Button>

              {autoBuy ? (
                <p className="text-sm text-mute">
                  Runs start without asking first.{' '}
                  <TextButton onClick={askBeforeRuns}>Ask me first</TextButton>
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p>
            Every confirmed meal is one of your own recipes, so there is nothing
            here for the agent to shop for.
          </p>
        )}

        {startError ? (
          <Banner
            variant="error"
            title="The agent could not do that"
            onDismiss={dismissStartError}
            compact
          >
            {startError}
          </Banner>
        ) : null}

        {hasEarlierRun && !sameMeals && !running ? (
          <Banner variant="warning" compact>
            The confirmed meals have changed since the agent last shopped. What
            is below is from that earlier run; the next run shops for the meals as
            they are now, as a new order.
          </Banner>
        ) : null}

        {run.phase === 'loading' ? (
          <LoadingState label="Loading your last shopping run…" />
        ) : null}

        {running ? (
          <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-5">
            <LoadingState label={run.status ?? 'Shopping…'} className="py-0 font-semibold text-ink" />
            {run.note ? (
              <Banner variant="warning" compact>
                {run.note}
              </Banner>
            ) : null}
            {run.error ? (
              <Banner variant="error" compact>
                {run.error}
              </Banner>
            ) : null}
            {run.approval ? <ApprovalNotice approval={run.approval} /> : null}
            <CartTable cart={run.cart} />
          </div>
        ) : null}

        {finished ? (
          <div className="min-w-0 border-t border-line pt-5">
            <RunResult />
          </div>
        ) : null}

        <p className="max-w-[56ch] text-sm text-mute">
          The stores are FeedMe&rsquo;s demo stores and payment runs in
          Stripe&rsquo;s sandbox. Card details never reach this app or our
          backend.
        </p>
      </div>

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
