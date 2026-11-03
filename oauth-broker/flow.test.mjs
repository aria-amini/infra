import { test } from 'node:test'
import assert from 'node:assert/strict'
import { betterAuth } from 'better-auth'
import { oAuthProxy } from 'better-auth/plugins'
import { createBrokerAuth } from './auth.mjs'

const proxySecret = 'test-only-proxy-secret-12345678901234567890'
const clientId = 'fake.apps.googleusercontent.com'
const clientSecret = 'fake-secret'
const appOrigin = 'https://app.example.com'
const brokerOrigin = 'https://broker.example.com'

test('a trusted app hands Google callback to the broker and gets an encrypted profile back', async () => {
  const app = betterAuth({
    baseURL: appOrigin,
    secret: 'test-only-app-secret-12345678901234567890',
    socialProviders: { google: { clientId, clientSecret } },
    plugins: [oAuthProxy({ productionURL: brokerOrigin, secret: proxySecret })],
  })
  const broker = createBrokerAuth({ origin: brokerOrigin, clientId, clientSecret, proxySecret })
  const start = await app.handler(new Request(`${appOrigin}/api/auth/sign-in/social`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: appOrigin },
    body: JSON.stringify({ provider: 'google', callbackURL: `${appOrigin}/recipes`, disableRedirect: true }),
  }))
  assert.equal(start.status, 200)
  const googleUrl = new URL((await start.json()).url)
  assert.equal(googleUrl.searchParams.get('redirect_uri'), `${brokerOrigin}/api/auth/callback/google`)
  const originalFetch = globalThis.fetch
  const jwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  globalThis.fetch = async (request, options) => {
    const url = request instanceof Request ? request.url : String(request)
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    assert.equal(options?.method, 'POST')
    const idToken = `${jwtPart({ alg: 'none' })}.${jwtPart({ sub: 'google-user', email: 'cook@example.test', email_verified: true, name: 'Cook' })}.signature`
    return Response.json({ access_token: 'fake-token', token_type: 'Bearer', expires_in: 3600, id_token: idToken })
  }
  try {
    const callback = new URL(`${brokerOrigin}/api/auth/callback/google`)
    callback.searchParams.set('state', googleUrl.searchParams.get('state'))
    callback.searchParams.set('code', 'fake-code')
    const response = await broker.handler(new Request(callback))
    assert.equal(response.status, 302)
    const destination = new URL(response.headers.get('location'))
    assert.equal(destination.origin, appOrigin)
    assert.match(destination.pathname, /oauth-proxy/)
    assert.ok(destination.searchParams.get('profile'))
    assert.equal(destination.href.includes('cook@example.test'), false)
  } finally { globalThis.fetch = originalFetch }
})
