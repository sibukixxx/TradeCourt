import { render } from 'preact'
import App from './App'
import './style.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
render(<App />, root)
