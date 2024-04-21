'use strict'

exports.setRoutes = async (server) => {
  server.app.get(
    '/api/v1/tokens/list',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        if (!req.query.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        if (!req.query.projectId) {
          res.status(400).json({ error: 'Missing projectId' })
          return
        }
        const org = await server.schemas.findOrganization(req.query.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.query.projectId,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        const tokens = await server.schemas.listTokens(project)
        res.json(tokens)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/tokens/create',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        if (!req.body.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        if (!req.body.projectId) {
          res.status(400).json({ error: 'Missing projectId' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.body.projectId,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        const token = await server.schemas.createToken({
          secretKey: server.config.secretKey,
          project,
          description: req.body.description,
          expiration: req.body.expiration
        })
        res.json({ token })
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/tokens/setDescription',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        const description = req.body.description
        if (typeof description !== 'string') {
          res.status(400).json({ error: 'Invalid description' })
          return
        }
        if (!req.body.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        if (!req.body.projectId) {
          res.status(400).json({ error: 'Missing projectId' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.body.projectId,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        const token = await server.schemas.findToken(req.body.token)
        if (!token) {
          res.status(404).json({ error: 'Token not found' })
          return
        }
        await server.schemas.setDescriptionForToken({ token, description })
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/tokens/delete',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        if (!req.body.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        if (!req.body.projectId) {
          res.status(400).json({ error: 'Missing projectId' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.body.projectId,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        const token = await server.schemas.findToken(req.body.token)
        if (!token) {
          res.status(404).json({ error: 'Token not found' })
          return
        }
        await token.destroy()
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  return []
}
