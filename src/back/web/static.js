'use strict'

const path = require('node:path')

const express = require('express')
const fs = require('fs-extra')

const { isValidFilename } = require('../grpc/service.js')

// The /storage URL of an asset, as served by the static /storage route.
function assetUrl (asset) {
  const key = Buffer.from(asset.id, 'hex')
  const hexKey = key.toString('hex')
  const key1 = hexKey.slice(0, 3)
  const key2 = hexKey.slice(3, 6)
  const key3 = hexKey.slice(6, 9)
  const key4 = hexKey.slice(9)
  const basePath = path.join('/storage', 'assets', key1, key2, key3, key4)
  return path.join(basePath, asset.filename).replace(/\\/g, '/')
}

exports.setRoutes = async (server) => {
  // Hopefully, /dist and /storage can be mapped by the front-end,
  // and these two routes shouldn't be used.
  const root = path.normalize(path.join(__dirname, '..', '..', '..'))
  server.app.use(express.static(path.join(root, 'dist')))
  server.app.use('/storage', express.static(path.join(root, 'storage')))
  // A helper as we'll use it frequently throughout the code.
  function sendRoot (req, res) {
    res.sendFile(path.join(root, 'dist', 'index.html'))
  }
  // All these routes are basically sending the root index.html file. There's no
  // logic behind them, as the Vue.js application page will do the right thing
  // to load the rest of the static project files from storage, or use other
  // REST APIs to do its work.
  const routes = [
    '/about',
    '/user/login',
    '/org/:orgId',
    '/org/:orgId/project/:projectId',
    '/pub/org/:orgId/project/:projectId'
  ]
  routes.map((route) => server.app.get(route, sendRoot))
  // While this one route is technically static, it returns a 302 towards the
  // latest build file, so it requires a database access.
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
      res.redirect(assetUrl(build.asset))
    } catch(err) {
        res.status(500).json({ error: err.toString() })
    }
  })

  // Version-predictable download URLs: /alias/<org>/<project>/<filename>
  // redirects to the newest build's asset of that name, and index.json is the
  // file the project owner uploaded with SetProjectIndex.
  server.app.get('/alias/:orgId/:projectId/:filename', async (req, res) => {
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
      const filename = req.params.filename
      if (filename === 'index.json') {
        let index
        try {
          index = await fs.readFile(
            path.join(server.getProjectManifestPath(project), 'index.json')
          )
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
          res.status(404).json({ error: 'No index uploaded' })
          return
        }
        res.set('Content-Type', 'application/json')
        res.set('Cache-Control', 'no-cache')
        res.send(index)
        return
      }
      if (!isValidFilename(filename)) {
        res.status(400).json({ error: 'Invalid filename' })
        return
      }
      const build = await server.schemas.getLastBuildByFilename(project, filename)
      if (!build || !build.asset) {
        res.status(404).json({ error: 'No build with that filename' })
        return
      }
      res.set('Cache-Control', 'no-cache')
      res.redirect(assetUrl(build.asset))
    } catch (err) {
      res.status(500).json({ error: err.toString() })
    }
  })

  return []
}
