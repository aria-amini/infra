import { betterAuth } from 'better-auth'
import { oAuthProxy } from 'better-auth/plugins'

export function createBrokerAuth({ origin, clientId, clientSecret, proxySecret }) {
  return betterAuth({
    baseURL: origin,
    secret: proxySecret,
    socialProviders: { google: { clientId, clientSecret } },
    plugins: [oAuthProxy({ productionURL: origin, secret: proxySecret })],
  })
}
