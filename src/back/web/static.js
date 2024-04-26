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
  server.app.get('/pub/org/:orgId/project/:projectId/latest', async (req, res) => {
    try {
      const org = await server.schemas.findOrganization(req.params.orgId)
      if (!org) {
        res.status(404).json({ error: 'Organization not found' })
        return
      }
      const project = await server.schemas.findProject({
        id: req.params.projectId,
        organization: org
      })
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const build = await server.schemas.getLastBuild(project)
      if (!build.asset) {
        res.status(404).json({ error: 'Build has no asset' })
        return
      }
      const key = Buffer.from(build.asset.id, 'hex')
      const hexKey = key.toString('hex')
      const key1 = hexKey.slice(0, 3)
      const key2 = hexKey.slice(3, 6)
      const key3 = hexKey.slice(6, 9)
      const key4 = hexKey.slice(9)
      const basePath = path.join('/storage', 'assets', key1, key2, key3, key4)
      res.redirect(path.join(basePath, build.asset.filename).replace(/\\/g, '/'))
    } catch(err) {
        res.status(500).json({ error: err.toString() })
    }
  })

  return []
}
