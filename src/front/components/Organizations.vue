<script setup>
import { generateSlug } from 'random-word-slugs'
import { useOrganizationsStore } from '../stores/organizations-store'
import { useLoginStore } from '../stores/login-store'

const orgs = useOrganizationsStore()
const login = useLoginStore()
</script>

<script>
export default {
  data: () => ({
    newOrgID: generateSlug(3),
    newOrgName: '',
    messages: [],
    validNewOrgID: true,
    orgs: useOrganizationsStore()
  }),
  watch: {
    newOrgID(value) {
      this.newOrgID = value
      this.validNewOrgID =
        typeof value === 'string' &&
        value.length <= 64 &&
        /^[a-z0-9-]+$/.test(value)
    }
  },
  methods: {
    async createNewOrg() {
      const name = this.newOrgName.trim()
      try {
        await this.orgs.create({ id: this.newOrgID, name })
      } catch (e) {
        const message = e?.body?.error || e.toString() || 'Unknown error'
        this.messages.push({
          text: `Error creating organization ${name}: ${message}`,
          severity: 'error'
        })
        return
      }
      this.messages.push({
        text: `Organization ${name} created successfully`,
        severity: 'success'
      })
      this.newOrgID = generateSlug(3)
      this.newOrgName = ''
    },
    goToOrganization(event) {
      this.$router.push(`/org/${event.target.id}`)
    }
  }
}
</script>

<template>
  <div v-if="login.info.authenticated && login.info.user.enabled" class="my-5">
    <div class="font-medium text-3xl text-900">Create new organization</div>
    <div class="surface-card p-4 shadow-2 border-round w-full lg:w-6">
      <form @submit.prevent="createNewOrg">
        <div class="flex flex-column gap-2">
          <label for="id" class="block text-900 font-medium mb-2">ID</label>
          <InputText id="id" v-model="newOrgID" aria-describedby="id-help" />
          <small v-if="!validNewOrgID" class="text-red-500">Invalid ID</small>
          <small id="id-help" class="mb-5"
            >This is the internal unique id, which will be used in URLs. Cannot
            be changed later. Can only contain letters, digits, and
            dashes.</small
          >
          <label for="name" class="block text-900 font-medium mb-2">Name</label>
          <InputText
            id="name"
            v-model="newOrgName"
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
      organizations.</Message
    >
  </div>
  <div v-if="orgs.asArray.length !== 0" class="my-5">
    <div class="font-medium text-3xl text-900">Organizations</div>
    <div class="surface-ground px-4 py-5 md:px-6 lg:px-8">
      <div class="grid">
        <div
          v-for="org in orgs.asArray"
          :key="org.id"
          class="col-12 md:col-6 lg:col-3"
        >
          <div
            :id="org.id"
            class="surface-card shadow-2 p-3 border-round cursor-pointer"
            @click="goToOrganization"
          >
            <span class="text-900 font-medium text-xl">{{ org.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
