'use strict'

exports.setRoutes = async (server) => {
  return [
    await require('./organizations.js').setRoutes(server),
    await require('./projects.js').setRoutes(server),
    await require('./tokens.js').setRoutes(server)
  ]
}
