'use strict'

const GitHubStrategy = require('passport-github2').Strategy
const Provider = require('../provider').Provider

exports.register = async (passport, schemas, config) => {
  const provider = new Provider('GitHub', 'github', 'github-connect', 'github')
  provider.registerStrategies(schemas, (strategyName, dbCallback) => {
    passport.use(
      strategyName,
      new GitHubStrategy(
        {
          clientID: config.providers.githubAuth.clientID,
          clientSecret: config.providers.githubAuth.clientSecret,
          callbackURL: config.webServer.baseURL.concat(
            '/api/v1/auth/github/callback'
          )
        },
        (tokenset, refreshToken, userinfo, done) => {
          const user = {
            provider: 'github',
            id: userinfo.id,
            avatarURL: userinfo.photos[0].value,
            screenName: userinfo.displayName || userinfo.username
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
