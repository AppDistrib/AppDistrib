<script setup>
import { useProvidersStore } from '../stores/providers-store.js'
import providerIcon from '../utils/provider-icon.js'

const providersStore = useProvidersStore()

</script>

<template>
  <div class="login surface-card p-4 shadow-2 border-round">
    <div class="text-3xl font-medium text-900 mb-3">
      Select your login provider
    </div>
    <div class="login-providers">
      <Button
        v-for="provider in providersStore.providers"
        :label="provider.name"
        :id="provider.id"
        :icon="providerIcon(provider)"
        @click="providersStore.login(provider.id)"
        class="p-button-outlined mb-2 login-provider block w-12rem"
      >
      </Button>
    </div>
  </div>
</template>
