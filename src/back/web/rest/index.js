'use strict'

// A helper to register all of the routes for all the REST endpoints.
exports.setRoutes = async (server) => {
  return [
    await require('./organizations.js').setRoutes(server),
    await require('./projects.js').setRoutes(server),
    await require('./tokens.js').setRoutes(server)
  ]
}
