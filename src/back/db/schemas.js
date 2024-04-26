'use strict'

const { DataTypes, Sequelize, QueryTypes } = require('sequelize')
const secureRandom = require('secure-random')
const base85 = require('base85')
const { sha3_256 } = require('@noble/hashes/sha3')
const { hmac } = require('@noble/hashes/hmac')

module.exports = class Schemas {
  constructor (db, server) {
    this.db = db
    this.server = server
    const sequelize = db.sequelize
    const User = sequelize.define('user', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      screenName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      avatarURL: {
        type: DataTypes.STRING,
        length: 2048,
        allowNull: true
      }
    })

    const ProvidedAuth = sequelize.define('providedAuth', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      screenName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      avatarURL: {
        type: DataTypes.STRING,
        length: 2048,
        allowNull: true
      }
    })
    User.ProvidedAuths = User.hasMany(ProvidedAuth, { onDelete: 'CASCADE' })
    ProvidedAuth.User = ProvidedAuth.belongsTo(User, {
      foreignKey: {
        allowNull: false
      }
    })

    const Organization = sequelize.define('organization', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      }
    })
    const OrganizationUser = sequelize.define('organizationUser', {
      role: {
        type: DataTypes.STRING,
        allowNull: false
      }
    })
    Organization.Users = Organization.belongsToMany(User, {
      through: OrganizationUser
    })
    User.Organizations = User.belongsToMany(Organization, {
      through: OrganizationUser
    })

    const Asset = sequelize.define('asset', {
      id: {
        type: DataTypes.STRING,
        length: 64,
        primaryKey: true
      },
      purpose: {
        type: DataTypes.STRING,
        allowNull: true
      },
      filename: {
        type: DataTypes.STRING,
        allowNull: false
      },
      mimeType: {
        type: DataTypes.STRING
      },
      hashes: {
        type: DataTypes.JSONB
      },
      size: {
        type: DataTypes.BIGINT
      }
    })
    Organization.Assets = Organization.hasMany(Asset, { onDelete: 'SET NULL' })
    Asset.Organization = Asset.belongsTo(Organization, { onDelete: 'SET NULL' })

    const Project = sequelize.define('project', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      historical: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100
      }
    })
    Organization.Projects = Organization.hasMany(Project, {
      onDelete: 'CASCADE'
    })
    Project.Organization = Project.belongsTo(Organization, {
      foreignKey: { allowNull: false }
    })
    Project.Assets = Project.hasMany(Asset, { onDelete: 'SET NULL' })
    Asset.Project = Asset.belongsTo(Project, { onDelete: 'SET NULL' })

    const Build = sequelize.define('build', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      buildId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT
      },
      manifest: {
        type: DataTypes.JSONB
      },
      keep: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }
    })
    Project.Builds = Project.hasMany(Build, { onDelete: 'CASCADE' })
    Build.Project = Build.belongsTo(Project, {
      foreignKey: { allowNull: false }
    })
    Asset.Build = Asset.hasMany(Build, { onDelete: 'SET NULL' })
    Build.Asset = Build.belongsTo(Asset, { foreignKey: { allowNull: false } })

    const Token = sequelize.define('token', {
      hash: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      expiration: {
        type: DataTypes.DATE,
        allowNull: true
      }
    })
    Project.Tokens = Project.hasMany(Token, { onDelete: 'CASCADE' })
    Token.Project = Token.belongsTo(Project)

    this.User = User
    this.ProvidedAuth = ProvidedAuth
    this.Organization = Organization
    this.Asset = Asset
    this.Project = Project
    this.Build = Build
    this.Token = Token
  }

  async serializeUser (user) {
    return {
      id: user.dataValues.id
    }
  }

  async deserializeUser (user) {
    const result = await this.User.findAll({
      where: {
        id: user.id
      },
      include: { model: this.ProvidedAuth }
    })
    return result.length === 0 ? false : result[0]
  }

  async findOrCreateUser (user) {
    const providerId = `${user.provider}#${user.id}`
    const result = await this.ProvidedAuth.findAll({
      where: {
        id: providerId
      }
    })
    if (result.length === 1) {
      return this.deserializeUser({ id: result[0].dataValues.userId })
    } else {
      return this.User.create(
        {
          screenName: user.screenName,
          avatarURL: user.avatarURL,
          providedAuths: [
            {
              id: providerId,
              screenName: user.screenName,
              avatarURL: user.avatarURL
            }
          ]
        },
        {
          include: [
            {
              association: this.User.ProvidedAuths,
              include: [this.ProvidedAuth.User]
            }
          ]
        }
      )
    }
  }

  async findUser (user) {
    const providerId = `${user.provider}#${user.id}`
    const result = await this.ProvidedAuth.findAll({
      where: {
        id: providerId
      }
    })
    if (result.length === 1) {
      return this.deserializeUser({ id: result[0].dataValues.userId })
    } else {
      return false
    }
  }

  async addProviderAccountToUser ({ user, account }) {
    const providerId = `${account.provider}#${account.id}`
    const userId = user.dataValues.id
    const result = await this.ProvidedAuth.findAll({
      where: {
        id: providerId
      }
    })
    if (result.length !== 0) {
      if (result[0].dataValues.userId === userId) {
        return user
      } else {
        throw Error('Account already connected by someone else')
      }
    } else {
      await this.ProvidedAuth.create({
        id: providerId,
        screenName: account.screenName,
        avatarURL: account.avatarURL,
        userId
      })
    }
    return this.deserializeUser({ id: userId })
  }

  async createOrganization ({ id, name, owner }) {
    if (!owner.enabled) {
      throw Error(
        "User hasn't been enabled yet. Please contact the administrator."
      )
    }
    const org = await this.Organization.create({ id, name })
    return owner.addOrganization(org, { through: { role: 'owner' } })
  }

  async findOrganization (id) {
    const result = await this.Organization.findAll({
      where: {
        id
      }
    })
    return result.length === 1 ? result[0] : false
  }

  async listOrganizationsForUser (user) {
    return user.getOrganizations()
  }

  async listUsersInOrganization (organization) {
    return organization.getUsers()
  }

  async renameOrganization ({ organization, name }) {
    return organization.update({ name })
  }

  async setDescriptionForOrganization ({ organization, description }) {
    return organization.update({ description })
  }

  async findProject ({ id, organization }) {
    const result = await this.Project.findAll({
      where: {
        id: organization.id + ':' + id,
        organizationId: organization.id
      }
    })
    return result.length === 1 ? result[0] : false
  }

  async listProjects (organization) {
    return this.Project.findAll({
      where: {
        organizationId: organization.id
      }
    })
  }

  async createProject ({ id, name, organization }) {
    const key = base85.encode(secureRandom.randomBuffer(32))
    return this.Project.create({
      id: organization.id + ':' + id,
      name,
      key,
      organizationId: organization.id
    })
  }

  async renameProject ({ project, name }) {
    return project.update({ name })
  }

  async setProjectDescription ({ project, description }) {
    return project.update({ description })
  }

  async listTokens (project) {
    return this.Token.findAll({
      where: {
        projectId: project.id
      }
    })
  }

  async createToken ({ secretKey, project, description, expiration }) {
    const token = secureRandom.randomBuffer(32)
    const hash = hmac.create(sha3_256, secretKey + '|' + project.key)
    hash.update(token)
    await this.Token.create({
      hash: base85.encode(Buffer.from(hash.digest())),
      projectId: project.id,
      description,
      expiration
    })
    const ret = base85.encode(token)
    return 'tk1.' + ret.replace(/\./g, '_')
  }

  async findToken (hash) {
    const result = await this.Token.findAll({
      where: {
        hash
      }
    })
    return result.length === 1 ? result[0] : false
  }

  async setDescriptionForToken ({ token, description }) {
    return token.update({ description })
  }

  async validateProjectFromToken ({ secretKey, token, project }) {
    const hash = hmac.create(sha3_256, secretKey + '|' + project.key)
    const tokenValues = token.split('.')
    if (tokenValues.length !== 2 || tokenValues[0] !== 'tk1') {
      return false
    }
    const tokenBuffer = base85.decode(tokenValues[1].replace(/_/g, '.'))
    hash.update(tokenBuffer)
    const digest = hash.digest()
    const result = await this.Token.findAll({
      where: {
        hash: base85.encode(Buffer.from(digest))
      },
      include: {
        model: this.Project,
        required: true
      }
    })
    return result.length === 1 && result[0].project.id === project.id
  }

  async getNextBuildId (project) {
    const result = await this.Build.findAll({
      where: {
        projectId: project.id
      },
      order: [['id', 'DESC']],
      limit: 1
    })
    return result.length === 0 ? 1 : result[0].buildId + 1
  }

  async getLastBuild (project) {
    const result = await this.Build.findAll({
      where: {
        projectId: project.id
      },
      order: [['id', 'DESC']],
      limit: 1,
      include: { model: this.Asset }
    })
    return result.length !== 0 ? result[0] : false;
  }

  async getBuild ({ project, id }) {
    const result = await this.Build.findByPk(project.id + ':' + id, {
      include: { model: this.Asset }
    })
    return result
  }

  async listBuilds (project) {
    return this.Build.findAll({
      where: {
        projectId: project.id
      },
      include: { model: this.Asset }
    })
  }

  async createBuild ({
    project,
    id,
    description = '',
    manifest = '',
    keep = false,
    assetId,
    filename,
    mimeType = 'application/octet-stream',
    hashes,
    size
  }) {
    assetId = assetId.toString('hex')
    await this.Asset.findOrCreate({
      where: {
        id: assetId
      },
      defaults: {
        id: assetId,
        filename,
        mimeType,
        hashes,
        size
      }
    })
    await this.Build.create({
      id: project.id + ':' + id,
      buildId: id,
      description,
      manifest,
      keep,
      projectId: project.id,
      assetId
    })
    const newBuild = await this.Build.findByPk(project.id + ':' + id, {
      include: { model: this.Asset }
    })

    const ephemeralBuilds = await this.Build.findAll({
      where: {
        projectId: project.id,
        keep: false
      },
      order: [['createdAt', 'ASC']]
    })

    if (ephemeralBuilds.length > project.historical) {
      const toDelete = ephemeralBuilds.slice(
        0,
        ephemeralBuilds.length - project.historical
      )
      for (const build of toDelete) {
        await this.server.deleteBuildFiles(build, project)
        await build.destroy()
      }
    }

    return newBuild
  }

  async findSomeOrphanAssets () {
    const assets = await this.db.sequelize.query(
      `
    SELECT assets.id FROM assets
      LEFT JOIN builds ON assets.id = builds."assetId"
      WHERE assets."organizationId" IS NULL
        AND assets."projectId" IS NULL
      GROUP BY assets.id
      HAVING COUNT(builds.id) = 0
      ORDER BY assets."createdAt" ASC LIMIT 10`,
      {
        type: QueryTypes.SELECT
      }
    )

    return Promise.all(
      assets.map((assetInfo) => this.Asset.findByPk(assetInfo.id))
    )
  }
}
