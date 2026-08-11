import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ScientificUiProvider } from '@jorpago2/scientific-ui'
import '@xyflow/react/dist/style.css'
import './carbon.scss'
import './index.css'
import '@jorpago2/scientific-ui/styles.css'

import App from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element was not found.')

createRoot(root).render(
  <StrictMode>
    <ScientificUiProvider><App /></ScientificUiProvider>
  </StrictMode>,
)
