import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconContext } from '@phosphor-icons/react'
import '@fontsource-variable/montserrat'
import './styles.css'
import App from './App'
import { startThemeWatcher } from './lib/theme'

// Resolve the theme before the map is created, so it starts in the right colors.
startThemeWatcher()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Solid icons, like the car's UI. Individual icons override (e.g. search, close). */}
    <IconContext.Provider value={{ weight: 'fill' }}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
)
