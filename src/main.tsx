import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GlobalTheme } from '@carbon/react'
import '@xyflow/react/dist/style.css'
import './carbon.scss'
import './index.css'
import App from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element was not found.')

createRoot(root).render(
  <StrictMode>
    <GlobalTheme theme="g10"><App /></GlobalTheme>
  </StrictMode>,
)
