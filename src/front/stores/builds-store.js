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
        const manifest = await api.get(
          `${this.orgId}/${this.projectId}/manifest.json`
        )
        this.organization = manifest.organization
        this.project = manifest.project
        for (const build of manifest.builds) {
          try {
            const buildManifest = await api.get(
              `${this.orgId}/${this.projectId}/manifest-${build.id}.json`
            )
            buildManifest.changelog = ''
            const createdAt = new Date(buildManifest.createdAt * 1000)
            buildManifest.createdAt = createdAt.toString()
            this.asArray.push(buildManifest)
            this.asMap[build.id] = buildManifest
            const response = await fetch(
              `/storage/changelogs/${this.orgId}/${this.projectId}/changelog-${build.id}.md`
            )
            if (response.status >= 200 && response.status < 300) {
              const changelog = await response.text()
              buildManifest.changelog = changelog
            }
          } catch (err) {}
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
