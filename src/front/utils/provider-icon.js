export default function providerIcon (provider) {
  switch (provider.id) {
    case 'google':
      return 'pi pi-google'
    case 'facebook':
      return 'pi pi-facebook'
    case 'github':
      return 'pi pi-github'
    case 'microsoft':
      return 'pi pi-microsoft'
    default:
      return `pi pi-${provider.id}`
  }
}
