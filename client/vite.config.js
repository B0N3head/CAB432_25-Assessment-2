import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import fs from 'fs'

// Get build-time version info
function getBuildInfo() {
  let version = '1.0.1'
  let gitHash = ''
  
  try {
    // Get version from package.json
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
    version = pkg.version || version
  } catch {}
  
  try {
    // Get git hash
    gitHash = execSync('git rev-parse HEAD').toString().trim()
  } catch {}
  
  return {
    version,
    gitHash,
    buildTime: new Date().toISOString()
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist'
  },
  define: {
    'import.meta.env.VITE_VERSION': JSON.stringify(getBuildInfo().version),
    'import.meta.env.VITE_GIT_HASH': JSON.stringify(getBuildInfo().gitHash),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(getBuildInfo().buildTime)
  }
})
