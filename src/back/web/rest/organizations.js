'use strict'

exports.setRoutes = async (server) => {
  // A simple GET endpoint to show the list of organizations
  // available to a logged in user.
  server.app.get(
    '/api/v1/orgs/list',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        const orgs = await server.schemas.listOrganizationsForUser(req.user)
        res.json(orgs)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  // A POST request to create an organization within a logged in user.
  server.app.post(
    '/api/v1/orgs/create',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        // The user is supposed to enter the id of the organization
        // to create, so we'll sanitize it here.
        const id = req.body.id
        if (
          typeof id !== 'string' ||
              id.length === 0 ||
              id.length > 64 ||
              !/^[a-z0-9-]+$/.test(id)
        ) {
          res.status(400).json({ error: 'Invalid ID' })
          return
        }
        // We can be a bit more lax with the organization name.
        const name = req.body.name
        if (typeof name !== 'string' || name.length === 0) {
          res.status(400).json({ error: 'Invalid name (cannot be empty)' })
          return
        }
        // This technically can be a race condition, but the database
        // will just throw a different error which will be displayed
        // as a 500 instead of a 409.
        const existingOrg = await server.schemas.findOrganization(id)
        if (existingOrg) {
          res
            .status(409)
            .json({ error: `Organization with ID ${id} already exists` })
        } else {
          const org = await server.schemas.createOrganization({
            id,
            name,
            owner: req.user
          })
          res.json(org)
        }
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  // A POST request to rename an organization.
  server.app.post(
    '/api/v1/orgs/rename',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        const name = req.body.name
        if (typeof name !== 'string' || name.length === 0) {
          res.status(400).json({ error: 'Invalid name (cannot be empty)' })
          return
        }
        if (!req.body.id) {
          res.status(400).json({ error: 'Missing id' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.id)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        await server.schemas.renameOrganization({ organization: org, name })
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  // A POST request to change the description of an organization.
  // While this endpoint exists, we currently do not have the UI
  // for it just yet.
  server.app.post(
    '/api/v1/orgs/setDescription',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        const description = req.body.description
        if (typeof description !== 'string') {
          res.status(400).json({ error: 'Invalid description' })
          return
        }
        if (!req.body.id) {
          res.status(400).json({ error: 'Missing id' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.id)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        await server.schemas.setOrganizationDescription({
          organization: org,
          description
        })
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  return []
}
