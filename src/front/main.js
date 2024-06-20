import 'primevue/resources/primevue.min.css'
import 'primevue/resources/themes/lara-dark-blue/theme.css'
import 'primeflex/primeflex.css'
import 'primeflex/themes/primeone-dark.css'
import 'primeicons/primeicons.css'
import 'vue-loading-overlay/dist/css/index.css'

import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

import { createApp } from 'vue'
import VueSimpleAlert from 'vue3-simple-alert'
import { LoadingPlugin } from 'vue-loading-overlay'
import PrimeVue from 'primevue/config'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useLoginStore, loginStoreSetApp } from './stores/login-store'
import { useProvidersStore, providersStoreSetApp } from './stores/providers-store'
import { organizationsStoreSetApp } from './stores/organizations-store'
import { projectsStoreSetApp } from './stores/projects-store'
import { tokensStoreSetApp } from './stores/tokens-store'

import errorCatcher from './utils/error-catcher'

const app = createApp(App)
  .use(router)
  .use(VueSimpleAlert)
  .use(LoadingPlugin)
  .use(PrimeVue)
  .component('Accordion', Accordion)
  .component('AccordionTab', AccordionTab)
  .component('Button', Button)
  .component('InputText', InputText)
  .component('Message', Message)
  .use(createPinia())
  .use(errorCatcher)
  .mount('#app')

loginStoreSetApp(app)
providersStoreSetApp(app)
organizationsStoreSetApp(app)
projectsStoreSetApp(app)
tokensStoreSetApp(app)

useLoginStore().sync()
useProvidersStore().sync()
