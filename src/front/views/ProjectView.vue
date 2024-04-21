<script setup>
import { useOrganizationsStore } from '../stores/organizations-store'
import { useProjectsStore } from '../stores/projects-store'
import { useLoginStore } from '../stores/login-store'
import { useTokensStore } from '../stores/tokens-store'

const orgs = useOrganizationsStore()
const login = useLoginStore()
</script>

<script>
export default {
  data: () => ({
    editName: false,
    newName: '',
    editTokenDescription: false,
    newTokenDescription: '',
    tokenBeingEdited: '',
    orgs: useOrganizationsStore(),
    projects: useProjectsStore(),
    tokens: useTokensStore(),
    messages: []
  }),
  watch: {
    '$route.params.orgId': {
      immediate: true,
      async handler() {
        this.projects.orgId = this.$route.params.orgId
        this.tokens.orgId = this.$route.params.orgId
        await this.projects.sync()
      }
    },
    '$route.params.projectId': {
      immediate: true,
      async handler() {
        this.tokens.projectId = this.$route.params.projectId
        await this.tokens.sync()
      }
    }
  },
  methods: {
    startEditingProjectName(event) {
      this.editName = true
      this.newName = this.projects.asMap[this.$route.params.projectId].name
      this.$nextTick(() => {
        document.getElementById('renameInput').select()
      })
    },
    async doneEditingProjectName() {
      this.editName = false
      await this.projects.rename({
        id: this.$route.params.projectId,
        name: this.newName
      })
    },
    startEditingTokenDescription(event) {
      this.tokenBeingEdited = event.currentTarget.id
      const inputId = 'input:' + event.currentTarget.id
      this.editTokenDescription = true
      this.newTokenDescription =
        this.tokens.asMap[event.currentTarget.id].description
      this.$nextTick(() => {
        document.getElementById(inputId).select()
      })
    },
    async doneEditingTokenDescription(event) {
      this.editTokenDescription = false
      await this.tokens.setDescription({
        token: this.tokenBeingEdited,
        description: this.newTokenDescription
      })
    },
    async deleteToken(token) {
      try {
        await this.tokens.delete(token)
      } catch (e) {
        const message = e?.body?.error || e.toString() || 'Unknown error'
        this.messages.push({
          text: `Error deleting token: ${message}`,
          severity: 'error'
        })
        return
      }
      this.messages.push({
        text: 'Token deleted successfully.',
        severity: 'success'
      })
    },
    async createNewToken() {
      let token = null
      const description = this.newTokenDescription.trim()
      try {
        token = await this.tokens.create(description)
      } catch (e) {
        const message = e?.body?.error || e.toString() || 'Unknown error'
        this.messages.push({
          text: `Error creating token: ${message}`,
          severity: 'error'
        })
        return
      }
      this.messages.push({
        text: 'Token created successfully. Copy the following token, as it cannot be retrieved again:',
        pre: token,
        severity: 'success',
        sticky: true
      })
      this.newTokenDescription = ''
    }
  }
}
</script>

<template>
  <div v-if="orgs.loading || projects.loading">
    <loading :active="true" :can-cancel="false" :is-full-page="true" />
  </div>
  <div v-else>
    <div v-if="projects.asMap[$route.params.projectId]">
      <div class="surface-card p-4 shadow-2 border-round w-full lg:w-6">
        <div
          v-if="!editName"
          class="font-medium text-3xl text-900"
          @click="startEditingProjectName"
        >
          {{ projects.asMap[$route.params.projectId].name }}
        </div>
        <div v-else>
          <InputText
            id="renameInput"
            v-model="newName"
            @keydown.enter="doneEditingProjectName"
            @blur="doneEditingProjectName"
          />
        </div>
      </div>
    </div>
    <div v-else>
      <Message severity="error" :sticky="true" :closable="false"
        >Project {{ $route.params.projectId }} not found.</Message
      >
    </div>
    <div
      v-if="login.info.authenticated && login.info.user.enabled"
      class="my-5"
    >
      <div class="font-medium text-3xl text-900">Create new token</div>
      <div class="surface-card p-4 shadow-2 border-round w-full lg:w-6">
        <form @submit.prevent="createNewToken">
          <div class="flex flex-column gap-2">
            <label for="description" class="block text-900 font-medium mb-2"
              >Description</label
            >
            <InputText
              id="description"
              v-model="newTokenDescription"
              aria-describedby="description-help"
            />
            <small id="description-help" class="mb-5"
              >This is for your own information.</small
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
          :sticky="msg.sticky || false"
          :life="5000"
          >{{ msg.text }}
          <pre class="ml-5">{{ msg.pre }}</pre>
        </Message>
      </div>
    </div>
    <div v-else class="my-5">
      <Message severity="error" :sticky="true" :closable="false"
        >You need to be logged in and your account needs to be enabled to create
        tokens.</Message
      >
    </div>
    <div v-if="tokens.asArray.length !== 0" class="my-5">
      <div class="font-medium text-3xl text-900">Tokens</div>
      <div class="surface-ground px-4 py-5 md:px-6 lg:px-8">
        <div class="grid">
          <div
            v-for="token in tokens.asArray"
            :key="token.hash"
            class="col-12 md:col-6 lg:col-3"
          >
            <div
              v-if="!editTokenDescription || token.hash !== tokenBeingEdited"
              :id="token.hash"
              class="surface-card shadow-2 p-3 border-round cursor-pointer"
            >
              <Button
                icon="pi pi-trash"
                class="p-button-rounded p-button-text p-button-sm"
                @click="deleteToken(token.hash)"
              ></Button>
              <span
                class="text-900 font-medium text-xl"
                @click="startEditingTokenDescription"
                >{{ token.description }}</span
              >
            </div>
            <div v-else>
              <InputText
                :id="'input:' + token.hash"
                v-model="newTokenDescription"
                @keydown.enter="doneEditingTokenDescription"
                @blur="doneEditingTokenDescription"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
