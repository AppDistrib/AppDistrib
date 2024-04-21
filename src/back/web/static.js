'use strict'

const path = require('node:path')

const express = require('express')

exports.setRoutes = async (server) => {
  const root = path.normalize(path.join(__dirname, '..', '..', '..'))
  server.app.use(express.static(path.join(root, 'dist')))
  server.app.use('/storage', express.static(path.join(root, 'storage')))
  function sendRoot (req, res) {
    res.sendFile(path.join(root, 'dist', 'index.html'))
  }
  const routes = [
    '/about',
    '/user/login',
    '/org/:orgId',
    '/org/:orgId/project/:projectId',
    '/pub/org/:orgId/project/:projectId'
  ]
  routes.map((route) => server.app.get(route, sendRoot))

  return []
}
