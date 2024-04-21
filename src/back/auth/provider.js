'use strict'

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
