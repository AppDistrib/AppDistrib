<script setup>
import ConnectedAuthProviders from '../components/ConnectedAuthProviders.vue'
import AvailableAuthProviders from '../components/AvailableAuthProviders.vue'
import Organizations from '../components/Organizations.vue'
import { useLoginStore } from '../stores/login-store.js'

const loginStore = useLoginStore()
</script>

<template>
  <div class="surface-section px-4 py-5 md:px-6 lg:px-8">
    <div v-if="!loginStore.info.authenticated">
      <div class="font-medium text-3xl text-900">
        User currently not logged in. Please
        <a class="no-underline line-height-3 cursor-pointer" href="/user/login"
          >login</a
        >
        first, or check the
        <a class="no-underline line-height-3 cursor-pointer" href="/about"
          >about</a
        >
        page for more information.
      </div>
    </div>
    <div v-else>
      <ConnectedAuthProviders />
      <AvailableAuthProviders />
      <Organizations />
    </div>
  </div>
</template>
