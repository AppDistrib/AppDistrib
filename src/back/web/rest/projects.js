'use strict'

exports.setRoutes = async (server) => {
  server.app.get(
    '/api/v1/projects/list',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        if (!req.query.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        const org = await server.schemas.findOrganization(req.query.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const projects = await server.schemas.listProjects(org)
        const results = []
        projects.forEach((project) => {
          const element = {}
          console.log(typeof project.dataValues)
          Object.keys(project.dataValues).forEach(key => {
            let value = project.dataValues[key]
            if (key === 'key') return
            if (key === 'id') value = value.split(':')[0]
            element[key] = value
          })
          results.push(element)
        })
        res.json(results)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/projects/create',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        if (!req.body.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
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
        const name = req.body.name
        if (typeof name !== 'string' || name.length === 0) {
          res.status(400).json({ error: 'Invalid name (cannot be empty)' })
          return
        }
        const existingProject = await server.schemas.findProject({
          id,
          organization: org
        })
        if (existingProject) {
          res.status(409).json({
            error: `Project with ID ${id} already exists within this organization.`
          })
        } else {
          const project = await server.schemas.createProject({
            id,
            name,
            organization: org
          })
          res.json(project)
          await server.generateProjectManifest(project, org)
        }
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/projects/rename',
    server.authenticationFilter({ forAPI: true }),
    async (req, res) => {
      try {
        const name = req.body.name
        if (typeof name !== 'string' || name.length === 0) {
          res.status(400).json({ error: 'Invalid name (cannot be empty)' })
          return
        }
        if (!req.body.orgId) {
          res.status(400).json({ error: 'Missing orgId' })
          return
        }
        if (!req.body.id) {
          res.status(400).json({ error: 'Missing id' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.body.id,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        await server.schemas.renameProject({ project, name })
        res.json({ success: true })
        await server.generateProjectManifest(project, org)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  server.app.post(
    '/api/v1/projects/setDescription',
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
        if (!req.body.id) {
          res.status(400).json({ error: 'Missing id' })
          return
        }
        const org = await server.schemas.findOrganization(req.body.orgId)
        if (!org || !(await org.hasUser(req.user))) {
          res.status(404).json({ error: 'Organization not found' })
          return
        }
        const project = await server.schemas.findProject({
          id: req.body.id,
          organization: org
        })
        if (!project) {
          res.status(404).json({ error: 'Project not found' })
          return
        }
        await server.schemas.setProjectDescription({ project, description })
        res.json({ success: true })
        await server.generateProjectManifest(project, org)
      } catch (err) {
        res.status(500).json({ error: err.toString() })
      }
    }
  )

  return []
}
