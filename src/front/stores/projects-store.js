import { defineStore } from 'pinia'
import { mande } from 'mande'
import { useTokensStore } from './tokens-store'

const api = mande('/api/v1/projects')

let app = null

export const useProjectsStore = defineStore('projects', {
  state: () => ({ loading: true, asArray: [], asMap: {}, orgId: null, _tokens: useTokensStore() }),
  actions: {
    async sync () {
      if (!this.orgId) return
      this.loading = true
      app.setErrorContext('Fetching projects')
      const projects =
        (await api.get('/list', { query: { orgId: this.orgId } })) || []
      this.loading = false
      this.asArray = projects
      this.asMap = projects.reduce((acc, project) => {
        acc[project.id] = project
        return acc
      }, {})
      await this._tokens.sync()
    },
    async create ({ id, name }) {
      app.setErrorContext('Creating project')
      await api.post('/create', { id, name, orgId: this.orgId })
      await this.sync()
    },
    async rename ({ id, name }) {
      app.setErrorContext('Renaming project')
      await api.post('/rename', { id, name, orgId: this.orgId })
      await this.sync()
    },
    async setDescription ({ id, description }) {
      app.setErrorContext('Setting project description')
      await api.post('/setDescription', { id, description })
      await this.sync()
    }
  }
})

export const projectsStoreSetApp = (newApp) => {
  app = newApp
}
