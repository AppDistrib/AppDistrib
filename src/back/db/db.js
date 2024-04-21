'use strict'

const { Sequelize } = require('sequelize')
const { Umzug, SequelizeStorage } = require('umzug')
const path = require('node:path')

class Database {
  constructor (config) {
    this.pgConfig = config
  }

  async connect () {
    const pgConfig = this.pgConfig
    if (pgConfig.useSocket) {
      this.sequelize = new Sequelize(
        pgConfig.database,
        pgConfig.user,
        pgConfig.password,
        {
          host: pgConfig.host,
          dialect: 'postgres'
        }
      )
    } else {
      this.sequelize = new Sequelize(
        `postgres://${pgConfig.user}:${pgConfig.password}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`
      )
    }
  }

  async initialize () {
    const sequelize = this.sequelize

    const umzug = new Umzug({
      migrations: {
        glob: path
          .join(__dirname, 'migrations', '*.js')
          .split(path.sep)
          .join('/')
      },
      context: sequelize,
      storage: new SequelizeStorage({ sequelize }),
      logger: console
    })

    await this.sequelize.authenticate()
    await umzug.up()
    console.log('Database migration resolved')
  }
}

exports.create = (pgConfig) => new Database(pgConfig)
