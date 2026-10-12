import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  approveCart,
  continueShoppingRun,
  fetchAutoBuy,
  fetchCart,
  fetchOrder,
  removeCartItem,
  saveAutoBuy,
  startShoppingRun,
} from '../lib/api'
import {
  budgetCents,
  mealsSignature,
  mealsToBuy,
  orderOutcome,
  statusForTool,
} from '../lib/shopping'
import { useHousehold } from '../hooks/useHousehold'
import { useMealPlan } from '../hooks/useMealPlan'
import { ShoppingRunContext } from './contexts'

const POLL_MS = 5_000

const WAITING_FOR_APPROVAL = 'Waiting for the payment to be approved in the Link app…'
const STILL_SHOPPING =
  'The agent is still shopping. This page checks on it every few seconds.'

// phase: 'idle' | 'loading' | 'running' | 'done' | 'failed'
// outcome, once done: 'paid' | 'unpaid'
const IDLE = {
  phase: 'idle',
  status: null,
  note: null,
  mode: null,
  cart: null,
  approval: null,
  summary: null,
  finishReason: null,
  outcome: null,
  error: null,
  orderId: null,
  listId: null,
  // True when the run is followed by asking for its order, not by its stream.
  detached: false,
}

// A run as its saved order tells it: after a reload, or when the stream was
// lost while the run carried on.
function fromOrder(order, cart) {
  const base = {
    ...IDLE,
    orderId: order.id,
    listId: order.grocery_list_id,
    mode: order.mode ?? null,
  }
  const outcome = orderOutcome(order)

  if (outcome === 'running') {
    return { ...base, phase: 'running', status: STILL_SHOPPING, cart, detached: true }
  }
  if (outcome === 'failed') {
    return {
      ...base,
      phase: 'failed',
      cart,
      summary: order.summary ?? null,
      error: order.error_message ?? 'The run did not finish.',
    }
  }
  return {
    ...base,
    phase: 'done',
    outcome: outcome === 'paid' ? 'paid' : 'unpaid',
    summary: order.summary ?? null,
    cart: cart ?? order.summary?.cart ?? null,
    finishReason: order.finish_reason ?? null,
  }
}

// Reads a run's saved order and its cart. `gone` means the order no longer
// exists, such as after the database was reset.
async function readRun(orderId, listId) {
  try {
    const [order, cart] = await Promise.all([
      fetchOrder(orderId),
      fetchCart(listId).catch(() => null),
    ])
    return { run: fromOrder(order, cart) }
  } catch (error) {
    if (error.status === 404) return { gone: true }
    return {
      run: {
        ...IDLE,
        phase: 'failed',
        orderId,
        listId,
        error: `Your last shopping run could not be loaded. ${error.message}`,
      },
    }
  }
}

// Sits above the three steps, so a run keeps streaming while the user looks
// at Setup or the plan. The run itself lives on the server and carries on
// whatever the browser does.
export function ShoppingRunProvider({ children }) {
  const { plan, recordShoppingRun } = useMealPlan()
  const { preferences } = useHousehold()

  const { meals, ownRecipes } = useMemo(() => mealsToBuy(plan), [plan])
  const signature = useMemo(() => mealsSignature(meals), [meals])
  // The last run for this plan: { orderId, listId, signature }.
  const saved = plan.shopping ?? null
  const savedOrderId = saved?.orderId ?? null
  const savedListId = saved?.listId ?? null

  const [run, setRun] = useState(IDLE)
  const [startError, setStartError] = useState(null)
  // Null until it has been read.
  const [autoBuy, setAutoBuy] = useState(null)
  const [cartBusy, setCartBusy] = useState(false)

  // The order whose answer is still wanted, so a slow one can't replace a
  // run that started since.
  const wanted = useRef(null)
  const streaming = useRef(false)
  const abort = useRef(null)

  // A run being read from its stream, as opposed to one read from its order.
  const live = run.phase === 'running' && !run.detached

  const showRun = useCallback(
    (orderId, result) => {
      if (wanted.current !== orderId) return
      if (result.gone) recordShoppingRun(null)
      else setRun(result.run)
    },
    [recordShoppingRun],
  )

  // The plan's last run is read when the page loads, and again whenever the
  // run on screen is not the plan's.
  useEffect(() => {
    if (!savedOrderId || live || streaming.current) return
    if (run.orderId === savedOrderId) return

    wanted.current = savedOrderId
    readRun(savedOrderId, savedListId).then((result) => showRun(savedOrderId, result))
  }, [live, run.orderId, savedListId, savedOrderId, showRun])

  // A run followed through its order is asked about every few seconds.
  useEffect(() => {
    if (run.phase !== 'running' || !run.detached || !run.orderId) return undefined

    const { orderId, listId } = run
    const timer = setTimeout(() => {
      wanted.current = orderId
      readRun(orderId, listId).then((result) => showRun(orderId, result))
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [run, showRun])

  useEffect(() => {
    let active = true
    fetchAutoBuy()
      .then((answer) => {
        if (active) setAutoBuy(Boolean(answer?.auto_buy))
      })
      .catch(() => {
        if (active) setAutoBuy(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Leaving stops the reading, never the run.
  useEffect(() => () => abort.current?.abort(), [])

  const sameMeals = Boolean(saved) && saved.signature === signature

  const start = useCallback(
    async ({ mode, remember = false }) => {
      if (!meals.length || streaming.current) return

      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      streaming.current = true
      wanted.current = null
      setStartError(null)

      // The same meals as the last run: carry on with its list, so only what
      // is still unbought is shopped for. Different meals get a list of their own.
      const continuing = sameMeals && saved?.listId
      let created = null
      let finished = false
      let failure = null

      setRun({
        ...IDLE,
        phase: 'running',
        status: 'Starting the buying agent…',
        mode,
        listId: continuing ? saved.listId : null,
      })

      const onEvent = (event) => {
        switch (event.type) {
          case 'run_created':
            created = { orderId: event.order_id, listId: event.grocery_list_id }
            recordShoppingRun({ ...created, signature })
            setRun((current) => ({ ...current, ...created }))
            // The server saves the choice just before the run opens.
            if (remember) setAutoBuy(true)
            break
          case 'run_started':
            setRun((current) => ({
              ...current,
              mode: event.mode,
              note: event.note ?? null,
              status: 'Checking which stores are open…',
            }))
            break
          case 'tool_call':
            setRun((current) => ({
              ...current,
              status: statusForTool(event.name, event.arguments),
            }))
            break
          case 'tool_result':
            // The model's longest turn: one pick for every item on the list.
            if (event.name === 'search_list') {
              setRun((current) => ({
                ...current,
                status: 'Choosing the best match for each item. This can take a minute…',
              }))
            }
            if (event.name === 'checkout') {
              setRun((current) => ({
                ...current,
                approval: null,
                status: 'Finishing up…',
              }))
            }
            break
          case 'cart_updated':
            setRun((current) => ({ ...current, cart: event.cart }))
            break
          case 'approval_needed':
            setRun((current) => ({
              ...current,
              status: WAITING_FOR_APPROVAL,
              approval: {
                stores: event.stores ?? [],
                totalCents: event.total_cents,
                url: event.approval_url ?? null,
              },
            }))
            break
          case 'error':
            failure = event.message
            setRun((current) => ({ ...current, error: event.message }))
            break
          case 'done':
            finished = true
            setRun((current) => ({
              ...current,
              phase: 'done',
              status: null,
              approval: null,
              summary: event.summary,
              cart: event.summary?.cart ?? current.cart,
              finishReason: event.finish_reason,
              outcome: event.summary?.orders?.length ? 'paid' : 'unpaid',
            }))
            break
          default:
            break
        }
      }

      try {
        const options = { onEvent, signal: controller.signal }
        if (continuing) {
          await continueShoppingRun(saved.listId, { mode, remember }, options)
        } else {
          await startShoppingRun(
            {
              meals,
              householdSize: Math.min(
                20,
                Math.max(1, Number(preferences.householdSize) || 1),
              ),
              budgetCents: budgetCents(preferences),
              mode,
              remember,
            },
            options,
          )
        }
        streaming.current = false

        if (!finished) {
          setRun((current) => ({
            ...current,
            phase: 'failed',
            status: null,
            approval: null,
            error: failure ?? 'The run ended before it finished.',
          }))
        }
      } catch (error) {
        streaming.current = false
        if (error?.name === 'AbortError') return

        // The stream was lost after the run began: the run carries on, so
        // follow its order instead.
        if (created) {
          setRun((current) => ({
            ...current,
            status: STILL_SHOPPING,
            approval: null,
            detached: true,
          }))
          return
        }

        // Refused before anything started. Clearing the run puts the plan's
        // last one, if there is one, back on screen.
        setStartError(error.message)
        setRun(IDLE)
      }
    },
    [meals, preferences, recordShoppingRun, sameMeals, saved, signature],
  )

  // The cart can be changed once no run is working on it.
  const changeCart = useCallback(
    async (change) => {
      if (!run.listId || run.phase === 'running') return
      setCartBusy(true)
      setStartError(null)
      try {
        const cart = await change(run.listId)
        setRun((current) => ({ ...current, cart }))
      } catch (error) {
        setStartError(error.message)
      } finally {
        setCartBusy(false)
      }
    },
    [run.listId, run.phase],
  )

  const approveAll = useCallback(() => changeCart(approveCart), [changeCart])

  const removeItem = useCallback(
    (store, upc) =>
      changeCart(async (listId) => {
        await removeCartItem(listId, store, upc)
        return fetchCart(listId)
      }),
    [changeCart],
  )

  // Back to being asked before each run.
  const askBeforeRuns = useCallback(async () => {
    try {
      const answer = await saveAutoBuy(false)
      setAutoBuy(Boolean(answer?.auto_buy))
    } catch (error) {
      setStartError(error.message)
    }
  }, [])

  // What the screens see: the run in state when it is live or the plan's own,
  // and otherwise nothing, or a wait while the plan's own is read.
  const shown = useMemo(() => {
    if (live || run.orderId === savedOrderId) return run
    if (!savedOrderId) return IDLE
    return { ...IDLE, phase: 'loading', orderId: savedOrderId, listId: savedListId }
  }, [live, run, savedListId, savedOrderId])

  const value = useMemo(
    () => ({
      meals,
      ownRecipes,
      // The last run shopped for these same meals, so the next one carries on.
      sameMeals,
      hasEarlierRun: Boolean(saved),
      canAuto: budgetCents(preferences) !== null,
      run: shown,
      startError,
      autoBuy,
      cartBusy,
      start,
      approveAll,
      removeItem,
      askBeforeRuns,
      dismissStartError: () => setStartError(null),
    }),
    [
      approveAll,
      askBeforeRuns,
      autoBuy,
      cartBusy,
      meals,
      ownRecipes,
      preferences,
      removeItem,
      sameMeals,
      saved,
      shown,
      start,
      startError,
    ],
  )

  return (
    <ShoppingRunContext.Provider value={value}>
      {children}
    </ShoppingRunContext.Provider>
  )
}
