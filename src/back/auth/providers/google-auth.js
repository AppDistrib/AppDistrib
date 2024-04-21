'use strict'

const openidClient = require('openid-client')
const Provider = require('../provider').Provider

exports.register = async (passport, schemas, config) => {
  // openidClient.Issuer.defaultHttpOptions = { timeout: 10000 }
  const googleIssuer = await openidClient.Issuer.discover(
    'https://accounts.google.com'
  )
  const client = new googleIssuer.Client({
    client_id: config.providers.googleAuth.clientID,
    client_secret: config.providers.googleAuth.clientSecret
  })
  client.CLOCK_TOLERANCE = 20

  const provider = new Provider(
    'Google',
    'oidc-google',
    'oidc-google-connect',
    'google'
  )
  provider.registerStrategies(schemas, (strategyName, dbCallback) => {
    passport.use(
      strategyName,
      new openidClient.Strategy(
        {
          client,
          params: {
            redirect_uri: config.webServer.baseURL.concat(
              '/api/v1/auth/google/callback'
            ),
            scope: 'openid profile'
          }
        },
        (tokenset, userinfo, done) => {
          const user = {
            provider: 'google',
            id: userinfo.sub,
            avatarURL: userinfo.picture,
            screenName: userinfo.name
          }
          dbCallback(user)
            .then((user) => done(null, user))
            .catch((err) => done(err, false))
        }
      )
    )
  })
  return provider
}
