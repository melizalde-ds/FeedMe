// A temporary page that shows every shared component in its states, so the
// system can be checked in a browser without signing in. Deleted in clean-up.
import { useState } from 'react'
import { AuthContext } from '../../src/contexts/contexts.js'
import { AppHeader } from '../../src/components/common/AppHeader.jsx'
import { Banner } from '../../src/components/common/Banner.jsx'
import { LoadingState, PlanBuildingState } from '../../src/components/common/LoadingState.jsx'
import { Modal } from '../../src/components/common/Modal.jsx'
import { SafetyDisclaimer } from '../../src/components/common/SafetyDisclaimer.jsx'
import { Button, IconButton, TextButton } from '../../src/components/ui/Button.jsx'
import { Chip, Choice, FieldError, Hint, Label, inputClass } from '../../src/components/ui/Field.jsx'
import { Alert, Check, Close, Plus } from '../../src/components/ui/icons.jsx'

const AUTH = { user: { email: 'you@example.com' }, signOut: () => {} }

function Section({ title, children }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

export function Gallery() {
  const [view, setView] = useState('plan')
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(true)

  return (
    <AuthContext.Provider value={AUTH}>
      <AppHeader view={view} onNavigate={setView} groceryReady={false} />
      <main className="mx-auto max-w-[1100px] px-4 pt-6 pb-24 sm:px-8">
        <h1 className="text-4xl font-extrabold tracking-tight">Design system</h1>
        <p className="mt-2 max-w-[65ch] text-mute">
          Every shared component, in its states. Type scale: <span className="text-xs">xs</span>{' '}
          <span className="text-sm">sm</span> <span className="text-ui">ui</span> base{' '}
          <span className="text-lg">lg</span> <span className="text-xl">xl</span>{' '}
          <span className="text-2xl">2xl</span> <span className="text-3xl">3xl</span>
        </p>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg">Confirm this week</Button>
            <Button variant="primary">Accept this meal</Button>
            <Button>Remake the plan</Button>
            <Button aria-pressed={pressed} onClick={() => setPressed(!pressed)}>{pressed ? 'Saved' : 'Save this recipe'}</Button>
            <Button variant="quiet">Cancel</Button>
            <Button variant="danger">Yes, delete</Button>
            <Button size="sm"><Plus size={14} /> Add</Button>
            <IconButton aria-label="Close"><Close /></IconButton>
            <TextButton>Edit setup</TextButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled>Building your plan…</Button>
            <Button disabled>Rejected</Button>
            <Button variant="danger" disabled>Yes, delete</Button>
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="g-email">Email</Label>
              <input id="g-email" type="email" className={`${inputClass} mt-1.5`} defaultValue="you@example.com" />
            </div>
            <div>
              <Label htmlFor="g-cal">Daily calories per person (kcal)</Label>
              <input id="g-cal" type="number" className={`${inputClass} mt-1.5`} defaultValue="1000" aria-invalid="true" aria-describedby="g-cal-error" />
              <FieldError id="g-cal-error">Use at least 1200 kcal a day.</FieldError>
            </div>
            <div>
              <Label htmlFor="g-period">Planning period</Label>
              <select id="g-period" className={`${inputClass} mt-1.5`} defaultValue="5">
                <option value="3">3 days</option>
                <option value="5">5 days</option>
                <option value="7">7 days</option>
              </select>
              <Hint>The planner chooses meals for these days.</Hint>
            </div>
            <div>
              <Label htmlFor="g-food">Foods you like</Label>
              <div className="mt-1.5 flex gap-2">
                <input id="g-food" type="text" className={inputClass} placeholder="e.g. chicken" />
                <Button>Add</Button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                <li><Chip onRemove={() => {}} removeLabel="Remove chicken">chicken</Chip></li>
                <li><Chip>mustard <span className="text-mute">(saved)</span></Chip></li>
              </ul>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="g-steps">Steps, one per line</Label>
              <textarea id="g-steps" rows="3" className={`${inputClass} mt-1.5`} placeholder="Brown the beef with the onion." />
            </div>
            <div>
              <Label htmlFor="g-off">Disabled</Label>
              <input id="g-off" className={`${inputClass} mt-1.5`} defaultValue="Signing in…" disabled />
            </div>
          </div>
          <div className="mt-5 grid max-w-3xl gap-2 sm:grid-cols-3">
            <Choice type="checkbox" defaultChecked>Vegetarian</Choice>
            <Choice type="checkbox">Vegan</Choice>
            <Choice type="checkbox" checked disabled readOnly>Tree nuts <span className="text-sm">(saved, can’t be removed)</span></Choice>
            <Choice type="radio" name="g-mode" defaultChecked><strong>Let me check everything</strong><span className="block text-sm text-mute">Every product the agent picks is marked for your review.</span></Choice>
            <Choice type="radio" name="g-mode" disabled><strong>Buy it for me</strong><span className="block text-sm">Set a grocery budget in Setup to use this.</span></Choice>
          </div>
        </Section>

        <Section title="Notices">
          <div className="grid gap-3">
            <Banner title="What changed" onDismiss={() => {}}>Swapped Easy Vegan Pancakes for Grandma B’s Super Waffles.</Banner>
            <Banner variant="warning" title="Heads up">We left out Honey Pecan Chicken Cutlets because the ingredients mention Tree nuts, which your household avoids.</Banner>
            <Banner variant="error" title="We could not build that plan" onDismiss={() => {}}>The planner is unavailable right now. Try again in a few minutes.</Banner>
          </div>
        </Section>

        <Section title="Photo tiles and flags">
          <div className="wall grid max-w-3xl grid-cols-4 gap-2.5">
            <button type="button" className="tile">
              <img className="tile__photo" alt="" src="https://img.sndimg.com/food/image/upload/w_555,h_416,c_fit,fl_progressive,q_95/v1/img/recipes/42/picVEMxk8.jpg" />
              <span className="tile__body"><span className="tile__name">Cabbage Soup</span><span className="tile__more">50 min · 104 kcal · 4.3 g protein</span></span>
            </button>
            <button type="button" className="tile" data-on="">
              <span className="tile__photo ruled" aria-hidden="true" />
              <span className="tile__top"><span className="flag">Yours</span><span className="flag" data-kind="ok"><Check size={13} />Accepted</span></span>
              <span className="tile__body"><span className="tile__name">Sunday Beef Chili</span><span className="tile__more">30 min · 550 kcal · 35 g protein</span></span>
            </button>
            <button type="button" className="tile" data-bad="">
              <span className="tile__photo ruled" aria-hidden="true" />
              <span className="tile__top"><span className="flag" data-kind="bad"><Alert size={13} />Contains Tree nuts</span></span>
              <span className="tile__body"><span className="tile__name">Almond Oat Bowl</span></span>
            </button>
            <button type="button" className="tile tile--empty"><Plus size={16} /><span className="text-sm font-semibold">Choose a meal</span></button>
          </div>
        </Section>

        <Section title="Waiting">
          <LoadingState label="Loading your last shopping run…" />
          <div className="mt-4"><PlanBuildingState /></div>
        </Section>

        <Section title="Dialog">
          <Button onClick={() => setOpen(true)}>Open the dialog</Button>
          {open ? (
            <Modal title="Shop for these groceries?" size="narrow" onClose={() => setOpen(false)}>
              <p>The buying agent will fill a cart at the stores and then ask for <strong>one payment for the whole cart</strong>.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setOpen(false)}>Yes, shop for them</Button>
                <Button onClick={() => setOpen(false)}>Not now</Button>
              </div>
            </Modal>
          ) : null}
        </Section>

        <SafetyDisclaimer />
      </main>
    </AuthContext.Provider>
  )
}
