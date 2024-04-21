import { defineStore } from 'pinia'
import { mande } from 'mande'

const api = mande('/api/v1/providers')

let app = null

export const useProvidersStore = defineStore('providers', {
  state: () => ({ providers: [], byId: {} }),
  actions: {
    async sync () {
      app.setErrorContext('Fetching providers')
      const providers = await api.get()
      this.providers = providers
      this.byId = this.providers.reduce((acc, provider) => {
        acc[provider.id] = provider
        return acc
      }, {})
    },
    login (id) {
      window.location.href = this.byId[id].loginPath
    },
    connect (id) {
      window.location.href = this.byId[id].connectPath
    }
  }
})

export const providersStoreSetApp = (newApp) => {
  app = newApp
}
