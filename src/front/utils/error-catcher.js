import Swal from 'sweetalert2'

export default function errorCatcher (app, options) {
  let context = 'Unknown context'
  app.config.globalProperties.$setErrorContext = function (action) {
    context = action
  }
  function errorHandler (err) {
    if (err?.response?.status === 401) {
      app.config.globalProperties.$router.push('/user/login')
      return
    }
    const message = err?.body?.error || err.toString() || 'Unknown error'
    Swal.fire({
      title: 'Uncaught error',
      text: `Last set context: ${context}. Error message: ${message}`,
      icon: 'error'
    })
  }
  app.config.errorHandler = function (err, vm, info) {
    errorHandler(err)
  }
  window.onerror = function (message, source, lineno, colno, error) {
    errorHandler(error || new Error(message))
  }
  window.addEventListener('unhandledrejection', function (event) {
    errorHandler(event.reason)
  })
}
