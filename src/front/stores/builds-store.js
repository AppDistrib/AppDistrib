import { defineStore } from 'pinia'
import { mande } from 'mande'

const api = mande('/storage/manifests')

export const useBuildsStore = defineStore('builds', {
  state: () => ({
    asArray: [],
    asMap: {},
    orgId: null,
    projectId: null,
    organization: {},
    project: {}
  }),
  actions: {
    async sync () {
      this.organization = {}
      this.project = {}
      this.asArray = []
      this.asMap = {}
      if (!this.orgId) return
      if (!this.projectId) return
      try {
        const manifest = await api.get(`${this.orgId}/${this.projectId}/manifest.json`)
        this.organization = manifest.organization
        this.project = manifest.project
        for (const build of manifest.builds) {
          try {
            const buildManifest = await api.get(`${this.orgId}/${this.projectId}/manifest-${build.id}.json`)
            const createdAt = new Date(buildManifest.createdAt * 1000)
            buildManifest.createdAt = createdAt.toString()
            this.asArray.push(buildManifest)
            this.asMap[build.id] = buildManifest
          } catch (err) { }
        }
      } catch (err) {
        this.organization = {}
        this.project = {}
        this.asArray = []
        this.asMap = {}
      }
    }
  }
})
