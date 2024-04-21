'use strict'

const { DataTypes, Deferrable } = require('sequelize')
const path = require('node:path')
const root = path.normalize(path.join(__dirname, '..', '..', '..', '..'))

const readFile = (path) =>
  new Promise((resolve, reject) =>
    require('fs').readFile(path, 'ascii', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  )

module.exports = {
  up: async function ({ context: sequelize }) {
    const User = sequelize.define('user', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
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
        type: DataTypes.INTEGER,
        primaryKey: true
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

    await Promise.all([
      readFile(
        path.join(root, 'node_modules', 'connect-pg-simple', 'table.sql')
      ).then((sessionsQuery) => sequelize.query(sessionsQuery)),
      sequelize.sync()
    ])
  },

  down: async function (sequelize) {
    await sequelize.getQueryInterface().dropAllTables()
  }
}
