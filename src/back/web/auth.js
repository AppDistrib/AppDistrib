'use strict'

const path = require('node:path')

const assert = require('node:assert')
const expressSession = require('express-session')
const pg = require('pg')
const PGSession = require('connect-pg-simple')(expressSession)
const passport = require('passport')

function pathToProvider (provider) {
  return path.join(__dirname, '..', 'auth', 'providers', provider)
}

const builtInAuthProviders = [
  {
    configName: 'googleAuth',
    src: pathToProvider('google-auth.js')
  },
  {
    configName: 'githubAuth',
    src: pathToProvider('github-auth.js')
  }
]

exports.setRoutes = async (server) => {
  const providers = []

  const pgPool = new pg.Pool(server.config.pgConfig)
  server.app.use(
    expressSession({
      store: new PGSession({
        pool: pgPool,
        tableName: 'session'
      }),
      secret: server.config.webServer.secret,
      resave: false,
      cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
    })
  )
  server.app.use(passport.initialize())
  server.app.use(passport.session())

  passport.serializeUser((user, done) =>
    server.schemas
      .serializeUser(user)
      .then((id) => done(null, id))
      .catch((err) => done(err, false))
  )

  passport.deserializeUser((id, done) =>
    server.schemas
      .deserializeUser(id)
      .then((user) => done(null, user))
      .catch((err) => done(err, false))
  )

  server.authenticationFilter = ({ returnURL = null, forAPI = false } = {}) => {
    return (req, res, next) => {
      if (req.isAuthenticated()) return next()
      req.session.returnURL = returnURL || req.returnURL || req.originalUrl
      if (forAPI) {
        res.status(401).json({ error: 'Unauthorized' })
      } else {
        res.redirect('/user/login')
      }
    }
  }

  function registerProvider (provider) {
    server.app.get(`/api/v1/auth/${provider.urlFragment}/login`, (req, res, next) => {
      try {
        if (req.isAuthenticated()) res.redirect('/render/profile')
        passport.authenticate(provider.create)(req, res, next)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    })
    server.app.get(
      `/api/v1/auth/${provider.urlFragment}/connect`,
      server.authenticationFilter(),
      (req, res, next) => {
        try {
          passport.authorize(provider.connect)(req, res, next)
        } catch (err) {
          res.status(500).json({ error: err.toString() })
        }
      }
    )
    function getReturnURL (req) {
      let returnURL = '/'
      if (req.session.returnURL) {
        returnURL = req.session.returnURL
        req.session.returnURL = null
      }
      return returnURL
    }
    server.app.get(
      `/api/v1/auth/${provider.urlFragment}/callback`,
      (req, res, next) => {
        try {
          const isConnecting = req.isAuthenticated()
          let middleware
          if (isConnecting) {
            middleware = passport.authorize(provider.connect, (err, account) => {
              if (err) return next(err)
              server.schemas
                .addProviderAccountToUser({ user: req.user, account })
                .then((user) => {
                  req.logIn(user, (err) => {
                    if (err) return next(err)
                    res.redirect(getReturnURL(req))
                  })
                })
                .catch((err) => next(err))
            })
          } else {
            middleware = passport.authenticate(provider.create, (err, user) => {
              if (err) return next(err)
              if (!user) return res.redirect('/user/login')

              req.logIn(user, (err) => {
                if (err) return next(err)
                res.redirect(getReturnURL(req))
              })
            })
          }
          middleware(req, res, next)
        } catch (err) {
          res.status(500).json({ error: err.toString() })
        }
      }
    )
  }

  server.app.post('/api/v1/user/logout', (req, res) => {
    try {
      req.logOut((err) => {
        if (err) {
          res.status(500).json({ error: err.toString() })
        } else {
          res.json({ success: true })
        }
      })
    } catch (err) {
      res.status(500).json({ error: err.toString() })
    }
  })

  server.app.get('/api/v1/user/info', (req, res) => {
    if (req.isAuthenticated()) {
      res.json({
        authenticated: true,
        user: req.user
      })
    } else {
      res.json({
        authenticated: false
      })
    }
  })

  server.app.get('/api/v1/providers', (req, res) => {
    res.json(providers)
  })

  const authProviders = builtInAuthProviders.concat(
    server.config.externalAuthProviders || []
  )

  const promises = []

  authProviders.forEach((providerValues) => {
    if (!server.config.providers[providerValues.configName]) return
    const registerPromise = require(providerValues.src).register(
      passport,
      server.schemas,
      server.config
    )
    promises.push(
      registerPromise.then((provider) => {
        assert(provider.urlFragment.indexOf('#') === -1)
        providers.push({
          id: provider.urlFragment,
          name: provider.name,
          loginPath: `/api/v1/auth/${provider.urlFragment}/login`,
          connectPath: `/api/v1/auth/${provider.urlFragment}/connect`
        })
        registerProvider(provider)
        return Promise.resolve()
      })
    )
  })

  return promises
}
