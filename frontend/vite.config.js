import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// The backend serves this build from a sub-path in production (cPanel's
// Node app URI, e.g. amlcompliance.com.au/hlgp — see server.js's dual
// '/hlgp'-prefixed + unprefixed route registrations), but `vite dev` always
// serves at localhost:5173's root. VITE_BASE_PATH lets a production build
// target whatever sub-path it's actually deployed under, defaulting to '/'
// so local dev and root-domain deploys need zero config.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
})
