import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

let child, base
before(async () => {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { PATH: process.env.PATH, PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('broker did not start')
})
after(() => child?.kill())
test('only exposes health and a disabled callback before configuration', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200)
  assert.equal((await fetch(`${base}/api/auth/callback/google`)).status, 503)
  assert.equal((await fetch(`${base}/api/auth/sign-in/social`, { method: 'POST' })).status, 404)
})
