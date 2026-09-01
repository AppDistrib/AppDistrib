'use strict'

// This index.js is for the entry point of the server, which really will go
// run the code from src/back
const server = require('./src/back/server.js')
const fs = require('fs-extra')
const { program } = require('commander')

async function main () {
  console.log('Server starting')
  program.name('appdistrib').description('AppDistrib server').version('1.0.0')
  program
    .option(
      '-c, --config <path>',
      'Path to the configuration file.',
      'config.json'
    )
    .option('--nuke Yes', 'Nuke the database and storage on startup', 'No')
  program.parse()

  const options = program.optsWithGlobals()
  let config = {}
  let raw
  try {
    raw = await fs.readFile(options.config, 'utf-8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // An absent config is allowed and gets the built-in defaults, but say so:
    // those defaults include a secretKey of 'test', which is what tokens are
    // validated against, and a storage secretKey of 'test', which is what every
    // asset path is derived from. Falling back to them by accident is not
    // something anyone should have to discover from the outside.
    console.warn(
      `No configuration file at ${options.config}, using defaults. ` +
        'Tokens and asset paths will use the built-in test keys.'
    )
  }
  if (raw !== undefined) config = JSON.parse(raw)
  config.nuke = options.nuke === 'Yes'
  await server.main(config)
}

main()
  .then(() => {
    console.log('Server started')
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
