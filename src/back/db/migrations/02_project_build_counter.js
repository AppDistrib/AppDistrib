'use strict'

// A per-project counter for build ids. GetNextBuildId hands an id out before
// the build is uploaded, and the client bakes it into the build's manifest, so
// each id has to be reserved when it is handed out: two callers asking at the
// same time must get two different ids. Existing projects start one past
// their highest build id.

module.exports = {
  up: async function ({ context: sequelize }) {
    const { DataTypes } = require('sequelize')
    const query = sequelize.getQueryInterface()
    await sequelize.transaction(async (transaction) => {
      await query.addColumn(
        'projects',
        'nextBuildId',
        { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
        { transaction }
      )
      await sequelize.query(
        `UPDATE projects SET "nextBuildId" =
           COALESCE((SELECT MAX("buildId")::bigint FROM builds WHERE "projectId" = projects.id), 0) + 1`,
        { transaction }
      )
    })
  },

  down: async function ({ context: sequelize }) {
    await sequelize.getQueryInterface().removeColumn('projects', 'nextBuildId')
  }
}
