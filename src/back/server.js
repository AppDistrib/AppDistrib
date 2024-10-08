'use strict'

const env = require('process').env
const fs = require('fs-extra')
const path = require('node:path')

const express = require('express')
const winston = require('winston')
const expressWinston = require('express-winston')
const bodyParser = require('body-parser')
const expressStatusMonitor = require('express-status-monitor')

const cron = require('node-cron')

const database = require('./db/db.js')
const Schemas = require('./db/schemas.js')

function setDefaultConfig (config) {
  if (!config) config = {}
  if (!config.secretKey) config.secretKey = 'test'
  if (!config.providers) {
    config.providers = {}
  }
  if (!config.storage) {
    config.storage = {
      secretKey: 'test',
      path: path.join(__dirname, '..', '..', 'storage')
    }
  }
  if (!config.storage.path) {
    config.storage.path = path.join(__dirname, '..', '..', 'storage')
  }
  if (!config.webServer) {
    config.webServer = {
      baseURL: 'http://localhost:8080',
      port: 8080,
      secret: 'test'
    }
  }
  if (!config.grpcConfig) {
    config.grpcConfig = {
      host: 'localhost',
      port: 50051
    }
  }
  if (!config.pgConfig) {
    config.pgConfig = {
      user: 'appdistrib',
      password: 'test',
      host: 'localhost',
      port: 5432,
      database: 'appdistrib'
    }
  }
  config.pgConfig.user = config.pgConfig.user || env.PGUSER
  config.pgConfig.password = config.pgConfig.password || env.PGPASSWORD
  config.pgConfig.host = config.pgConfig.host || env.PGHOST
  config.pgConfig.port = config.pgConfig.port || env.PGPORT
  config.pgConfig.database = config.pgConfig.database || env.PGDATABASE

  return config
}

class Server {
  constructor (config) {
    this.config = setDefaultConfig(config)
    this.app = express()
    this.app.use(expressStatusMonitor())
    this.app.use(bodyParser.json())
    this.app.use(
      expressWinston.logger({
        transports: [new winston.transports.Console()],
        meta: true,
        expressFormat: true
      })
    )
  }

  async moveAsset (srcPath, filename, key) {
    if (key.constructor === Uint8Array) {
      key = Buffer.from(key)
    }
    if (!Buffer.isBuffer(key)) {
      throw new Error('Invalid key type')
    }
    if (key.length !== 32) {
      throw new Error('Invalid key length')
    }
    const hexKey = key.toString('hex')
    const key1 = hexKey.slice(0, 3)
    const key2 = hexKey.slice(3, 6)
    const key3 = hexKey.slice(6, 9)
    const key4 = hexKey.slice(9)
    const destPath = path.join(
      this.config.storage.path,
      'assets',
      key1,
      key2,
      key3,
      key4
    )
    const destBin = path.join(
      path.dirname(destPath),
      path.basename(destPath) + '.data'
    )
    await fs.ensureDir(destPath)
    if (await fs.pathExists(destBin)) {
      await fs.remove(srcPath)
    } else {
      await fs.move(srcPath, destBin)
    }
    await fs.remove(path.join(destPath, filename))
    await fs.ensureLink(destBin, path.join(destPath, filename))
    await fs.chmod(destBin, 0o644)
    await fs.chmod(path.join(destPath, filename), 0o644)
  }

  async deleteAsset (key, filename) {
    if (key.constructor === Uint8Array) {
      key = Buffer.from(key)
    }
    if (!Buffer.isBuffer(key)) {
      throw new Error('Invalid key type')
    }
    if (key.length !== 32) {
      throw new Error('Invalid key length')
    }
    const hexKey = key.toString('hex')
    const key1 = hexKey.slice(0, 3)
    const key2 = hexKey.slice(3, 6)
    const key3 = hexKey.slice(6, 9)
    const key4 = hexKey.slice(9)
    const destPath = path.join(
      this.config.storage.path,
      'assets',
      key1,
      key2,
      key3,
      key4
    )
    const destBin = path.join(
      path.dirname(destPath),
      path.basename(destPath) + '.data'
    )
    await fs.remove(destBin)
    await fs.remove(path.join(destPath, filename))
    await fs.remove(destPath)
  }

  async deleteBuildFiles (build, project) {
    const projectFragment = project.id.replace(/:/g, '/')
    await fs.remove(path.join(this.config.storage.path, 'manifests', projectFragment, `manifest-${build.buildId}.json`))
    await fs.remove(path.join(this.config.storage.path, 'changelogs', projectFragment, `changelog-${build.buildId}.md`))
  }

  async generateBuildManifest (build, project) {
    if (!build.asset) return
    const key = Buffer.from(build.asset.id, 'hex')
    const hexKey = key.toString('hex')
    const key1 = hexKey.slice(0, 3)
    const key2 = hexKey.slice(3, 6)
    const key3 = hexKey.slice(6, 9)
    const key4 = hexKey.slice(9)
    const basePath = path.join('/storage', 'assets', key1, key2, key3, key4)
    const projectPath = path.join(
      this.config.storage.path,
      'manifests',
      project.id.replace(/:/g, '/')
    )
    const createdAt = Math.floor(build.createdAt.getTime() / 1000)
    const hashes = build.asset.hashes
    for (const hash in hashes) {
      hashes[hash] = Buffer.from(hashes[hash]).toString('hex')
    }
    const manifest = {
      id: build.buildId,
      path: path.join(basePath, build.asset.filename).replace(/\\/g, '/'),
      manifest: build.manifest,
      size: build.asset.size,
      hashes,
      createdAt
    }
    await fs.ensureDir(projectPath)
    await fs.writeFile(
      path.join(projectPath, `manifest-${build.buildId}.json`),
      JSON.stringify(manifest, null, 2)
    )
  }

  async generateBuildChangelog (build, project, changelog) {
    if (!changelog) return
    const projectPath = path.join(
      this.config.storage.path,
      'changelogs',
      project.id.replace(/:/g, '/')
    )
    await fs.ensureDir(projectPath)
    await fs.writeFile(
      path.join(projectPath, `changelog-${build.buildId}.md`),
      changelog
    )
  }

  async generateProjectManifest (project, organization) {
    const builds = await this.schemas.listBuilds(project)
    const manifest = {
      organization: {
        name: organization.name,
        description: organization.description
      },
      project: {
        name: project.name,
        description: project.description
      },
      builds: []
    }
    for (const build of builds) {
      if (!build.asset) {
        build.destroy()
        continue
      }
      const createdAt = Math.floor(build.createdAt.getTime() / 1000)
      manifest.builds.push({
        id: build.buildId,
        createdAt
      })
    }
    manifest.builds.sort((a, b) => b.id - a.id)
    const projectPath = path.join(
      this.config.storage.path,
      'manifests',
      project.id.replace(/:/g, '/')
    )
    await fs.ensureDir(projectPath)
    await fs.writeFile(
      path.join(projectPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
  }

  async deleteSomeEmptyFolders (dir) {
    const files = await fs.readdir(dir)
    if (files.length === 0) {
      await fs.rmdir(dir)
    } else {
      for (const file of files) {
        const fullPath = path.join(dir, file)
        if ((await fs.stat(fullPath)).isDirectory()) {
          await this.deleteSomeEmptyFolders(fullPath)
        }
      }
    }
  }

  async initialize () {
    const db = database.create(this.config.pgConfig)
    await db.connect()
    if (this.config.nuke) {
      const query = db.sequelize.getQueryInterface()
      await query.dropAllTables()
      await fs.remove(this.config.storage.path)
    }
    await db.initialize()
    this.schemas = new Schemas(db, this)

    cron.schedule('*/5 * * * *', async () => {
      const assetsToDelete = await this.schemas.findSomeOrphanAssets()
      for (const asset of assetsToDelete) {
        await this.deleteAsset(Buffer.from(asset.id, 'hex'), asset.filename)
        await asset.destroy()
      }
    })

    cron.schedule('42 3 * * *', async () => {
      await this.deleteSomeEmptyFolders(this.config.storage.path)
    })

    return [
      new Promise((resolve, reject) => {
        this.app.listen(this.config.webServer.port, this.config.webServer.host || '0.0.0.0', () => {
          resolve()
        })
      })
    ]
  }
}

exports.main = async (config) => {
  const server = new Server(config)
  const promises = []
  promises.concat(await server.initialize())
  promises.concat(await require('./web/static.js').setRoutes(server))
  promises.concat(await require('./web/auth.js').setRoutes(server))
  promises.concat(await require('./web/rest/index.js').setRoutes(server))
  promises.concat(await require('./grpc/service.js').setService(server))

  return Promise.all(promises)
}
