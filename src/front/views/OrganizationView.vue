<script setup>
import { generateSlug } from 'random-word-slugs'
import { useOrganizationsStore } from '../stores/organizations-store'
import { useProjectsStore } from '../stores/projects-store'
import { useLoginStore } from '../stores/login-store'

const orgs = useOrganizationsStore()
const login = useLoginStore()
</script>

<script>
export default {
  data: () => ({
    editName: false,
    newName: '',
    orgs: useOrganizationsStore(),
    projects: useProjectsStore(),
    newProjectID: generateSlug(3),
    newProjectName: '',
    messages: [],
    validNewProjectID: true
  }),
  watch: {
    '$route.params.orgId': {
      immediate: true,
      async handler() {
        this.projects.orgId = this.$route.params.orgId
        await this.projects.sync()
      }
    },
    newProjectID(value) {
      this.newProjectID = value
      this.validNewProjectID =
        typeof value === 'string' &&
        value.length <= 64 &&
        /^[a-z0-9-]+$/.test(value)
    }
  },
  methods: {
    goToProject(event) {
      this.$router.push(
        `/org/${this.$route.params.orgId}/project/${event.target.id}`
      )
    },
    startEditingOrgName(event) {
      this.editName = true
      this.newName = this.orgs.asMap[this.$route.params.orgId].name
      this.$nextTick(() => {
        document.getElementById('renameInput').select()
      })
    },
    async doneEditingOrgName() {
      this.editName = false
      await this.orgs.rename({ id: this.$route.params.orgId, name: this.newName })
    },
    async createNewProject() {
      const name = this.newProjectName.trim()
      try {
        await this.projects.create({ id: this.newProjectID, name })
      } catch (e) {
        const message = e?.body?.error || e.toString() || 'Unknown error'
        this.messages.push({
          text: `Error creating organization ${name}: ${message}`,
          severity: 'error'
        })
        return
      }
      this.messages.push({
        text: `Project ${name} created successfully`,
        severity: 'success'
      })
      this.newProjectID = generateSlug(3)
      this.newProjectName = ''
    }
  }
}
</script>

<template>
  <div v-if="orgs.loading">
    <loading :active="true" :can-cancel="false" :is-full-page="true" />
  </div>
  <div v-else>
    <div v-if="orgs.asMap[$route.params.orgId]">
      <div class="surface-card p-4 shadow-2 border-round w-full lg:w-6">
        <div
          v-if="!editName"
          class="font-medium text-3xl text-900"
          @click="startEditingOrgName"
        >
          {{ orgs.asMap[$route.params.orgId].name }}
        </div>
        <div v-else>
          <InputText
            id="renameInput"
            v-model="newName"
            @keydown.enter="doneEditingOrgName"
            @blur="doneEditingOrgName"
          />
        </div>
      </div>
    </div>
    <div v-else>
      <Message severity="error" :sticky="true" :closable="false"
        >Organization {{ $route.params.orgId }} not found.</Message
      >
    </div>
    <div
      v-if="login.info.authenticated && login.info.user.enabled"
      class="my-5"
    >
      <div class="font-medium text-3xl text-900">Create new project</div>
      <div class="surface-card p-4 shadow-2 border-round w-full lg:w-6">
        <form @submit.prevent="createNewProject">
          <div class="flex flex-column gap-2">
            <label for="id" class="block text-900 font-medium mb-2">ID</label>
            <InputText
              id="id"
              v-model="newProjectID"
              aria-describedby="id-help"
            />
            <small v-if="!validNewProjectID" class="text-red-500"
              >Invalid ID</small
            >
            <small id="id-help" class="mb-5"
              >This is the internal unique id, which will be used in URLs.
              Cannot be changed later. Can only contain letters, digits, and
              dashes.</small
            >
            <label for="name" class="block text-900 font-medium mb-2"
              >Name</label
            >
            <InputText
              id="name"
              v-model="newProjectName"
              aria-describedby="name-help"
            />
            <small id="name-help" class="mb-5"
              >This is a display name, and can be changed later.</small
            >
          </div>
          <Button
            type="submit"
            label="Create"
            class="w-12rem"
            icon="pi pi-plus"
          ></Button>
        </form>
        <Message
          v-for="msg of messages"
          :severity="msg.severity"
          :sticky="false"
          :life="5000"
          >{{ msg.text }}</Message
        >
      </div>
    </div>
    <div v-else class="my-5">
      <Message severity="error" :sticky="true" :closable="false"
        >You need to be logged in and your account needs to be enabled to create
        projects.</Message
      >
    </div>
    <div v-if="projects.asArray.length !== 0" class="my-5">
      <div class="font-medium text-3xl text-900">Projects</div>
      <div class="surface-ground px-4 py-5 md:px-6 lg:px-8">
        <div class="grid">
          <div
            v-for="project in projects.asArray"
            :key="project.id"
            class="col-12 md:col-6 lg:col-3"
          >
            <div
              :id="project.id"
              class="surface-card shadow-2 p-3 border-round cursor-pointer"
              @click="goToProject"
            >
              <span class="text-900 font-medium text-xl">{{ project.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
