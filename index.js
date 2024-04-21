'use strict'

const server = require('./src/back/server.js')
const fs = require('fs-extra')
const { program } = require('commander')

function main () {
  program.name('appdistrib').description('AppDistrib server').version('1.0.0')
  program.option(
    '-c, --config <path>',
    'Path to the configuration file.',
    'config.json'
  )

  const options = program.optsWithGlobals()

  return fs
    .readFile(options.config, 'utf-8')
    .then((data) => {
      return server.main(JSON.parse(data))
    })
    .catch(() => {
      return server.main()
    })
}

main()
  .then(() => {
    console.log('Server started')
  })
  .catch((err) => {
    console.error(err)
  })
