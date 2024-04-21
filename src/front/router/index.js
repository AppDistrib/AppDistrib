import { createRouter, createWebHistory } from 'vue-router'
import AboutView from '../views/AboutView.vue'
import LoginView from '../views/LoginView.vue'
import HomeView from '../views/HomeView.vue'
import OrganizationView from '../views/OrganizationView.vue'
import ProjectView from '../views/ProjectView.vue'
import ProjectPublicView from '../views/ProjectPublicView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView
    },
    {
      path: '/user/login',
      name: 'login',
      component: LoginView
    },
    {
      path: '/org/:orgId',
      name: 'organization',
      component: OrganizationView
    },
    {
      path: '/org/:orgId/project/:projectId',
      name: 'project',
      component: ProjectView
    },
    {
      path: '/pub/org/:orgId/project/:projectId',
      name: 'projectPublicView',
      component: ProjectPublicView
    }
  ]
})

export default router
