'use strict'

exports.setRoutes = async (server) => {
  // A simple GET endpoint, to get the list of tokens
  // associated with a given project. The user needs
  // to be logged in, and part of the organization owning
  // the given project.
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

  // A POST endpoint to create a token. This will actually generate
  // a random token, which will then be returned to the web client,
  // for displaying purposes. The token will not be stored as-is into
  // the database, and only a hashed version will exist, so it will
  // be impossible to recompute the clear-text token once it has been
  // gone from this function and displayed on the user's screen.
  // Technically, tokens support the notion of time-based expiration,
  // but we don't have the necessary plumbing for it just yet.
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

  // A POST endpoint to set the description for a given token. Unlike
  // the other setDescription endpoints, this one is actually bound
  // to some UI element.
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

  // A POST endpoint to delete a token. Useful when the user has lost the
  // clear-text version of a given token, and that it needs to be refreshed.
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
