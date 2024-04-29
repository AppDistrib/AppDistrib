<script setup>
import { useBuildsStore } from '../stores/builds-store'
import MarkdownIt from 'markdown-it'
import path from 'path'

const markdown = new MarkdownIt()

const builds = useBuildsStore()
function humanReadableSize(size) {
  if (size < 1024) {
    return size + ' bytes'
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + ' KB'
  } else {
    return (size / 1024 / 1024).toFixed(2) + ' MB'
  }
}
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
        <a
          class="text-3xl font-medium text-900 mb-3 no-underline"
          :href="build.path"
          target="_blank"
        >
          <i class="pi pi-download mr-3" style="font-size: 1.5rem"></i>Build
          {{ build.id }} :: {{ path.basename(build.path) }}</a
        >
        <div class="font-medium text-500 mb-3">
          Published {{ build.createdAt }}, {{ humanReadableSize(build.size) }}
        </div>
        <div
          class="border-2 border-dashed surface-border"
          v-html="markdown.render(build.changelog)"
        ></div>
      </div>
    </div>
  </div>
</template>
