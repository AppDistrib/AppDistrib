<script setup>
import { computed } from 'vue'
import { useLoginStore } from '../stores/login-store.js'
import { useProvidersStore } from '../stores/providers-store.js'
import providerIcon from '../utils/provider-icon.js'

const loginStore = useLoginStore()
const providersStore = useProvidersStore()

const availableProvidersToConnect = computed(() => {
  if (loginStore.info.authenticated) {
    const usedProviders = []
    loginStore.info.user.providedAuths.forEach((providedAuth) => {
      usedProviders.push(providedAuth.id.split('#')[0])
    })
    return providersStore.providers.filter(
      (provider) => !usedProviders.includes(provider.id)
    )
  } else {
    return providersStore.providers
  }
})
</script>

<script>
export default {
  methods: {
    connect(providerID) {
      this.$loading.show({ container: null, canCancel: false })
      providersStore.connect(providerID)
    },
  },
}
</script>

<template>
  <div v-if="availableProvidersToConnect.length !== 0" class="my-5">
    <div class="font-medium text-3xl text-900">
      Available Authentication Providers
      <div class="surface-card shadow-2 p-3 border-round">
        <Button
          v-for="provider in availableProvidersToConnect"
          :label="provider.name"
          :id="provider.id"
          :icon="providerIcon(provider)"
          @click="providersStore.connect(provider.id)"
          class="p-button-outlined mb-2 login-provider block w-12rem"
        >
        </Button>
      </div>
    </div>
  </div>
</template>
