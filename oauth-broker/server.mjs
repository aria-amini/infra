import { createServer } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import { createBrokerAuth } from './auth.mjs'

const port = Number(process.env.PORT || 8080)
const origin = process.env.BROKER_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_PROXY_SECRET } = process.env
const configured = Boolean(origin && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && OAUTH_PROXY_SECRET)
const auth = configured ? createBrokerAuth({
  origin,
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  proxySecret: OAUTH_PROXY_SECRET,
}) : null
const handleAuth = auth && toNodeHandler(auth)

createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
  } else if (req.method === 'GET' && path === '/api/auth/callback/google') {
    if (!handleAuth) res.writeHead(503).end('oauth broker is not configured')
    else void handleAuth(req, res)
  } else {
    res.writeHead(404).end('not found')
  }
}).listen(port, '0.0.0.0')
