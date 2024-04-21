<script setup>
import { useBuildsStore } from '../stores/builds-store'

const builds = useBuildsStore()
</script>

<script>
export default {
  data: () => ({
    builds: useBuildsStore()
  }),
  watch: {
    '$route.params.orgId': {
      immediate: true,
      async handler() {
        this.builds.orgId = this.$route.params.orgId
        await this.builds.sync()
      }
    },
    '$route.params.projectId': {
      immediate: true,
      async handler() {
        this.builds.projectId = this.$route.params.projectId
        await this.builds.sync()
      }
    }
  }
}
</script>
<template>
  <div>
    <h1>{{ builds.organization.name }} :: {{ builds.project.name }}</h1>
    <div v-for="build in builds.asArray" :key="build.id">
      <div class="surface-card p-4 shadow-2 border-round">
        <a class="text-3xl font-medium text-900 mb-3 no-underline" :href="build.path" target="_blank">Build {{ build.id }}</a>
        <div class="font-medium text-500 mb-3">Published {{ build.createdAt }}.</div>
        <div class="border-2 border-dashed surface-border"></div>
      </div>
    </div>
  </div>
</template>
