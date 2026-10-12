# FeedMe web app

The React app for FeedMe. One signed-in screen in three steps:

1. **Setup.** Allergies first, then diet, tastes, nutrition goals, budget and cooking time.
2. **Plan.** The week as a wall of recipe photographs, one rail per meal. Opening a meal unfolds its recipe and its alternatives; a row above the wall sums up each day.
3. **Grocery.** The grocery list for the plan, and the buying agent's run, cart and payment approval.

Built with React 19, Vite, Tailwind CSS 4 and React Router. The design system (colour, type, components, motion) is described in [`DESIGN.md`](DESIGN.md).

## How it talks to the backend

- **Sign-in** goes straight to Supabase with `supabase-js` and the public anon key.
- **Everything else** goes to the FastAPI server under `/api`, with the user's access token. In development, Vite proxies `/api` to http://localhost:8000.
- **A shopping run** is read as a stream with `fetch`, since it is a `POST` that needs an auth header.

Every recipe is checked against the household's allergies again in the browser before it is shown (`src/lib/allergySafety.js`). The server is the main check; this one is a second line.

Setup is saved to the account. The plan and the user's own recipes are kept in browser storage for now.

## What is in it

| Folder | What it holds |
|---|---|
| `src/pages/` | Home, sign-in and registration |
| `src/components/` | The views, grouped by step: `setup`, `plan`, `grocery`, plus `account`, `recipes` and `common` |
| `src/components/ui/` | The shared pieces every view is built from: buttons, fields, icons, table styles |
| `src/styles/` | The design tokens and Tailwind theme (`app.css`), and the photo wall's own styles (`wall.css`) |
| `src/contexts/`, `src/hooks/` | State for auth, household, meal plan, own recipes and shopping runs |
| `src/lib/` | API client, planner helpers, the allergy check and validation |

## Run it

From the repo root, with the backend running:

```bash
pnpm install
pnpm dev:web
```

The app is at http://localhost:5173. No web-specific configuration is needed for local development: the anon key is read from the `.env` at the repo root. To override a default, see [`.env.example`](.env.example).

```bash
pnpm build    # type-check and build
pnpm lint     # oxlint
```
