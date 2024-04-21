<script setup>
import { computed } from 'vue'
import Toolbar from 'primevue/toolbar'
import { RouterView, useRoute } from 'vue-router'
import { useLoginStore } from './stores/login-store.js'

const loginStore = useLoginStore()
const route = useRoute()

const showApp = computed(() => route.name !== 'projectPublicView')
</script>

<script>
export default {
  methods: {
    goToHome() {
      this.$router.push('/')
    },
    goToAbout() {
      this.$router.push('/about')
    },
    goToLogin() {
      this.$router.push('/user/login')
    },
    setErrorContext(context) {
      this.$setErrorContext(context)
    }
  },
}
</script>

<template>
  <Toolbar v-if="showApp">
    <template #start>
      <Button label="Home" class="p-button-outlined mr-2" icon="pi pi-home" @click="goToHome"></Button>
      <Button label="About" class="p-button-outlined" icon="pi pi-question" @click="goToAbout"></Button>
      </template>
    <template #end>
      <Button label="Login" v-if="!loginStore.info.authenticated" icon="pi pi-sign-in" @click="goToLogin"></Button>
      <Button label="Logout" v-if="loginStore.info.authenticated" icon="pi pi-sign-out" @click="loginStore.logout()"></Button>
    </template>
  </Toolbar>
  <RouterView />
</template>
