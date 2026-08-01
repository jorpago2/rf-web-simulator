import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element was not found.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
