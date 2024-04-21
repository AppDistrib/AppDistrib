import { defineStore } from 'pinia'
import { mande } from 'mande'
import { useOrganizationsStore } from './organizations-store.js'

const api = mande('/api/v1/user')

let app = null

export const useLoginStore = defineStore('login', {
  state: () => ({
    info: { authenticated: false },
    _orgs: useOrganizationsStore()
  }),
  actions: {
    async sync () {
      app.setErrorContext('Fetching user info')
      const info = await api.get('/info')
      this.info = info
      if (this.info.authenticated) {
        await this._orgs.sync()
      }
    },
    async logout () {
      app.setErrorContext('Logging out')
      this.info = { authenticated: false }
      await api.post('/logout')
    }
  }
})

export const loginStoreSetApp = (newApp) => {
  app = newApp
}
