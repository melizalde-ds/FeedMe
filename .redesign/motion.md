# Motion

How the redesign decided what moves. The method is the three Emil Kowalski
skills in `.agents/skills`: `find-animation-opportunities` to choose,
`animate` to build, `review-animations` to check. All motion is CSS; no
library was added. It is verified by `.redesign/scripts/07-motion.js`, with
reduced motion off and on.

## What moves, and why

| # | Where | What happens | Why | How often | Ingredients |
|---|---|---|---|---|---|
| 1 | A meal on the wall (`wall.css`, `.tile`) | Grows 5%, gets a lime ring, slides its details up, and the other meals drop to 55% | State: which meal is in hand. This is the direction's signature | Tens a day | `transform` and `opacity`, 200ms, `--ease-out`. Mouse hover only where there is a real pointer |
| 2 | A meal that changes (`.tile__photo`) | The new photograph fades in | Stops the tile blinking from one dish to another | Occasional | `opacity` from 0 with `@starting-style`, 200ms |
| 3 | A flag on a meal (`.flag`) | "Changed", "Accepted" and the rest ease in from 90% | State: something about this meal is now different | Occasional | `opacity` and `scale`, 160ms |
| 4 | A notice (`.notice`) | Eases in with a 4px drop | It was not there a moment ago | Occasional | `opacity` and `translate`, 200ms |
| 5 | The recipe shelf (`.unfold`) | Unfolds downward from its rail | Shows where the recipe came from | Occasional | `clip-path`, `opacity`, `transform`, 280ms |
| 6 | A dialog (`dialog.sheet`) | Rises 12px and fades in; the backdrop fades | A change of context | Occasional | 220ms |
| 7 | A product the agent adds to the cart (`.row-in`) | Fades in | The cart is filling while you watch | Rare | `opacity`, 240ms |
| 8 | Confirming the week (`.draw`, `.arrive`) | The tick draws itself and "Go to grocery list" steps forward | The one moment of completion in the app | Rare | 400ms draw after 120ms; 240ms `opacity` and `scale` |
| 9 | Everything you can press | A button, a header step, a week tab and a chip press to 97%; a meal on the wall to 98% | Feedback | Tens a day | `scale`, 160ms |
| 10 | Waiting (`.pulse`) | The loading dot and the waiting tiles breathe, staggered by 120ms | The half-minute wait has to look alive | Rare | background colour, 1.4s loop, `--ease-in-out` |

Curves: `--ease-out` is `cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out`
is `cubic-bezier(0.77, 0, 0.175, 1)`, both from the skills' shared vocabulary.

## What does not move, and why

- **Setup, Plan, Grocery, and the week tabs.** Core navigation, used tens of
  times a session. They switch at once.
- **The theme button.** A whole-page colour change should not crossfade.
- **Adding and removing terms and ingredients in forms.** The user is typing;
  motion would slow them down.
- **"How this page works".** Animating its height needs a property only
  Chromium has, for a disclosure most people open once.
- **The plan's figures.** Numbers the user is reading do not count up.
- **Closing a dialog or the shelf.** An exit animation would need the
  component to outlive its own state, or a motion library. They close at once.

## Reduced motion

With `prefers-reduced-motion: reduce` the fades stay and everything that moves
or grows goes. Meals keep the lime ring but do not grow, and their details are
always showing. The shelf and dialogs fade in without sliding. The confirmed
tick is drawn already. The waiting pulse runs at half speed.

## Review

Checked against the ten standards of `review-animations`. No `transition:
all`, no `ease-in`, no `scale(0)`, no layout properties, no ungated hover
motion. Two findings were applied: the details on a tile used to animate
`max-height` and now use `transform` and `opacity`, and the dimming of the
other meals was softened from 45% to 55%, because it happens on every pass of
the mouse.

Two things are deliberate exceptions. A new photograph and a new cart row
enter with a fade and no transform: moving either would shift the content the
user is reading. The tick takes 400ms, over the 300ms budget, because it is
the app's one celebration and is seen once a week.

One thing can only be judged by eye: whether 5% growth and 55% dimming feel
right when the mouse crosses the whole wall quickly. Both values are in
`wall.css` under "In hand".
