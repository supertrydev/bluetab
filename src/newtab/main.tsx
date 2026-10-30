import React from 'react'
import ReactDOM from 'react-dom/client'
import NewTab from './NewTab'
import { initializeNewTabTextSize } from './text-size'
import '../styles/tailwind.css'

async function mountNewTab(): Promise<void> {
    document.title = 'BlueTab'

    try {
        await initializeNewTabTextSize()
    } catch (error) {
        console.error('Failed to initialize text size service:', error)
    }

    const root = document.getElementById('root')
    if (!root) {
        return
    }

    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <NewTab />
        </React.StrictMode>,
    )
}

void mountNewTab()
