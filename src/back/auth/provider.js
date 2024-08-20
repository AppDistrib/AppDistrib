'use strict'

// The class is a generic mechanism to handle any sort
// of auth provider. The auth providers need to use it
// in order to provide a sane interface to the rest
// of our application.
class Provider {
  constructor (name, create, connect, urlFragment) {
    this.name = name
    this.create = create
    this.connect = connect
    this.urlFragment = urlFragment
  }

  registerStrategies (schemas, factory) {
    factory(this.create, (user) => {
      return schemas.findOrCreateUser(user)
    })
    factory(this.connect, (user) => {
      return Promise.resolve(user)
    })
  }
}

exports.Provider = Provider
