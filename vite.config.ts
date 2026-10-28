import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    // PartyKit keeps its local durable state here; writing it must not reload the app.
    watch: {
      ignored: ["**/.partykit/**"],
    },
  },
})
