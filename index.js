'use strict'

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
  try {
    config = JSON.parse(await fs.readFile(options.config, 'utf-8'))
  } catch (err) {}
  config.nuke = options.nuke === 'Yes'
  await server.main(config)
}

main()
  .then(() => {
    console.log('Server started')
  })
  .catch((err) => {
    console.error(err)
  })
