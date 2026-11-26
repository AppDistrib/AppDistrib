'use strict'

// What 00_initial.js declared and never got. Its model copy asks for four
// non-null foreign keys, but each belongsTo runs after the matching hasMany
// has already created the column as nullable, so the option is dropped. Its
// `length: 2048` on avatarURL is not a Sequelize attribute option, so both
// columns came out as VARCHAR(255). And it creates no indexes, so every
// upload's build-id lookup and retention pass scans the whole builds table.
// 00_initial.js is already applied on existing databases, so it stays as it is
// and the fixes live here.
//
// Setting NOT NULL fails if a row already holds a null, and the transaction
// rolls back with it, leaving the database as it was.

const NOT_NULL = [
  ['providedAuths', 'userId'],
  ['projects', 'organizationId'],
  ['builds', 'projectId'],
  ['builds', 'assetId']
]

const WIDE = [
  ['users', 'avatarURL'],
  ['providedAuths', 'avatarURL']
]

const INDEXES = [
  ['builds', ['projectId', 'buildId']],
  ['builds', ['projectId', 'keep', 'createdAt']],
  ['builds', ['assetId']],
  ['tokens', ['projectId']],
  ['projects', ['organizationId']],
  ['assets', ['organizationId']],
  ['assets', ['projectId']],
  ['providedAuths', ['userId']],
  ['organizationUsers', ['userId']]
]

const indexName = (table, fields) => `${table}_${fields.join('_')}`

module.exports = {
  INDEXES,
  indexName,
  up: async function ({ context: sequelize }) {
    const { DataTypes } = require('sequelize')
    const query = sequelize.getQueryInterface()
    await sequelize.transaction(async (transaction) => {
      for (const [table, column] of NOT_NULL) {
        await query.sequelize.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`,
          { transaction }
        )
      }
      for (const [table, column] of WIDE) {
        await query.changeColumn(
          table,
          column,
          { type: DataTypes.STRING(2048), allowNull: true },
          { transaction }
        )
      }
      for (const [table, fields] of INDEXES) {
        await query.addIndex(table, fields, {
          name: indexName(table, fields),
          transaction
        })
      }
    })
  },

  down: async function ({ context: sequelize }) {
    const { DataTypes } = require('sequelize')
    const query = sequelize.getQueryInterface()
    await sequelize.transaction(async (transaction) => {
      for (const [table, fields] of INDEXES) {
        await query.removeIndex(table, indexName(table, fields), { transaction })
      }
      for (const [table, column] of WIDE) {
        await query.changeColumn(
          table,
          column,
          { type: DataTypes.STRING(255), allowNull: true },
          { transaction }
        )
      }
      for (const [table, column] of NOT_NULL) {
        await query.sequelize.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`,
          { transaction }
        )
      }
    })
  }
}
