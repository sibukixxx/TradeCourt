import { render } from 'preact'
import App from './App'
import './style.css'
import { getLang } from './i18n'

document.documentElement.lang = getLang()

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
render(<App />, root)
