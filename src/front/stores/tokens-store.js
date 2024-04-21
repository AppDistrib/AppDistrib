import { defineStore } from 'pinia'
import { mande } from 'mande'

const api = mande('/api/v1/tokens')

let app = null

export const useTokensStore = defineStore('tokens', {
  state: () => ({
    asArray: [],
    asMap: {},
    orgId: null,
    projectId: null
  }),
  actions: {
    async sync () {
      if (!this.orgId) return
      if (!this.projectId) return
      app.setErrorContext('Fetching tokens')
      const tokens =
        (await api.get('/list', {
          query: { orgId: this.orgId, projectId: this.projectId }
        })) || []
      this.asArray = tokens
      this.asMap = tokens.reduce((acc, token) => {
        acc[token.hash] = token
        return acc
      }, {})
    },
    async create (description) {
      app.setErrorContext('Creating token')
      const response = await api.post('/create', {
        description,
        orgId: this.orgId,
        projectId: this.projectId
      })
      await this.sync()
      return response.token
    },
    async setDescription ({ token, description }) {
      app.setErrorContext('Setting token description')
      await api.post('/setDescription', {
        token,
        description,
        orgId: this.orgId,
        projectId: this.projectId
      })
      await this.sync()
    },
    async delete (token) {
      app.setErrorContext('Deleting token')
      await api.post('/delete', {
        token,
        orgId: this.orgId,
        projectId: this.projectId
      })
      await this.sync()
    }
  }
})

export const tokensStoreSetApp = (newApp) => {
  app = newApp
}
