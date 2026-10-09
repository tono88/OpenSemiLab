// Development-only entry: exercise the real application shell and laboratory.
// Production Vite builds have a single index.html entry and exclude this fixture.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import '../../src/styles.css'
import '../../src/plot-enhancements.css'
import '../../src/design.css'
import '../../src/workbench.css'
import '../../src/worker-health.css'
import '../../src/language.css'
import '../../src/project-workspace.css'
import '../../src/result-artifacts.css'
import '../../src/eda-visualizations.css'
import '../../src/library-cards.css'
import '../../src/pages.css'
import '../../src/editor.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
