<script setup>
import { computed } from 'vue'
import { useLoginStore } from '../stores/login-store.js'
import { useProvidersStore } from '../stores/providers-store.js'

const loginStore = useLoginStore()
const providersStore = useProvidersStore()

function providedAuthToProvider(providedAuth) {
  const provider = providersStore.providers.find(
    (provider) => provider.id === providedAuth.id.split('#')[0]
  )
  return provider || { name: 'Unknown' }
}
</script>

<template>
  <div class="my-5">
    <div class="font-medium text-3xl text-900">
      Connected Authentication Providers
    </div>
    <div
      v-for="providedAuth in loginStore.info.user.providedAuths"
      class="surface-card shadow-2 p-3 border-round"
    >
      <ul class="list-none p-0 m-0 flex align-items-center font-medium mb-3">
        <li>
          <span class="text-700 line-height-3">
            {{ providedAuthToProvider(providedAuth).name }}
          </span>
        </li>
        <li class="px-2">
          <i class="pi pi-angle-right text-500 line-height-3"></i>
        </li>
        <li>
          <span class="text-900 line-height-3">
            {{ providedAuth.screenName }}
          </span>
        </li>
      </ul>
      <img :src="providedAuth.avatarURL" alt="avatar" class="ml-2 w-10rem" />
    </div>
  </div>
</template>
