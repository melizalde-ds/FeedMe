// A temporary page that shows every shared component in its states, so the
// system can be checked in a browser without signing in. Deleted in clean-up.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/schibsted-grotesk/wght.css'
import '../../src/styles/app.css'
import { Gallery } from './Gallery.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
