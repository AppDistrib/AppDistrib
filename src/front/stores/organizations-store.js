import { defineStore } from 'pinia'
import { mande } from 'mande'
import { useProjectsStore } from './projects-store'

const api = mande('/api/v1/orgs')

let app = null

export const useOrganizationsStore = defineStore('organizations', {
  state: () => ({ loading: true, asArray: [], asMap: {}, _projects: useProjectsStore() }),
  actions: {
    async sync () {
      this.loading = true
      app.setErrorContext('Fetching organizations')
      const orgs = (await api.get('/list')) || []
      this.loading = false
      this.asArray = orgs
      this.asMap = orgs.reduce((acc, org) => {
        acc[org.id] = org
        return acc
      }, {})
      await this._projects.sync()
    },
    async create ({ id, name }) {
      app.setErrorContext('Creating organization')
      await api.post('/create', { id, name })
      await this.sync()
    },
    async rename ({ id, name }) {
      app.setErrorContext('Renaming organization')
      await api.post('/rename', { id, name })
      await this.sync()
    },
    async setDescription ({ id, description }) {
      app.setErrorContext('Setting organization description')
      await api.post('/setDescription', { id, description })
      await this.sync()
    }
  }
})

export const organizationsStoreSetApp = (newApp) => {
  app = newApp
}
