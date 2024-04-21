'use strict'

function setOptions(options) {
  const ret = {
    quiet: false,
    insecure: false,
    host: 'api.distrib.app',
    port: 443,
  }

  if (options.quiet !== undefined) {
    ret.quiet = options.quiet
  }
  ret.token = options.token
  if (ret.token === undefined) {
    ret.token = process.env.APPDISTRIB_TOKEN
  }
  if (ret.token === undefined) {
    throw new Error('No project token provided')
  }
  ret.project = options.project
  if (ret.project === undefined) {
    ret.project = process.env.APPDISTRIB_PROJECT
  }
  if (ret.project === undefined) {
    throw new Error('No project ID provided')
  }
  ret.organization = options.organization
  if (ret.organization === undefined) {
    ret.organization = process.env.APPDISTRIB_ORGANIZATION
  }
  if (ret.organization === undefined) {
    throw new Error('No organization ID provided')
  }
  if (options.insecure !== undefined) {
    ret.insecure = options.insecure
  }
  if (options.host !== undefined) {
    ret.host = options.host
  }
  if (options.port !== undefined) {
    ret.port = options.port
  }
  if (options.keep !== undefined) {
    ret.keep = options.keep
  }
  if (options.buildid !== undefined) {
    ret.buildid = options.buildid
  }
  if (options.manifest !== undefined) {
    ret.manifest = options.manifest
  }

  return ret
}

async function createGrpcClient(options) {
  const path = require('node:path')
  const promisify = require('node:util').promisify
  const grpc = require('@grpc/grpc-js')
  const protoLoader = require('@grpc/proto-loader')
  const pkgDefinition = await protoLoader.load(
    path.join(__dirname, 'appdistrib.proto'),
    { oneofs: true }
  )
  options.pkg = grpc.loadPackageDefinition(pkgDefinition)
  const client = new options.pkg.appdistrib.AppDistrib(
    `${options.host}:${options.port}`,
    options.insecure
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl()
  )
  const metadata = new grpc.Metadata()
  metadata.add('token', options.token)
  metadata.add('project', options.project)
  metadata.add('organization', options.organization)
  const origGetNextBuildId = client.GetNextBuildId
  client.GetNextBuildId = promisify((callback) => {
    return origGetNextBuildId.call(client, {}, metadata, callback)
  })
  const origNewBuild = client.NewBuild
  client.NewBuild = () => {
    return origNewBuild.call(client, metadata)
  }
  return client
}

async function main() {
  const fs = require('fs-extra')
  const { program } = require('commander')
  const cliProgress = require('cli-progress')

  program.name('appdistrib').description('CLI to AppDistrib').version('1.0.0')

  program
    .option('-q, --quiet', 'Quiet mode.')
    .option(
      '-h, --host <host>',
      'Hostname of the AppDistrib server to use.',
      'api.distrib.app'
    )
    .option('--port <port>', 'Port of the AppDistrib server to use.', 443)
    .option('-i, --insecure', 'Use an insecure connection (no SSL).')
    .option(
      '-t, --token <token>',
      'Project token to use to authenticate to the AppDistrib server.'
    )
    .option(
      '-p, --project <project>',
      'Project ID to use to authenticate to the AppDistrib server.'
    )
    .option(
      '-o, --organization <organization>',
      'Organization ID to use to authenticate to the AppDistrib server.'
    )
    // technically, these are part of the upload command, but it seems
    // that commander isn't working properly?
    .option(
      '-b, --buildid <buildid>',
      'The build ID to use. If not provided, a new one will be requested.'
    )
    .option(
      '-m, --manifest <file>',
      'The manifest file to attach to the build.'
    )
    .option('-k, --keep', 'Flag the build to be kept forever.')

  program
    .command('buildid')
    .description('Retrieves the next build ID to use for a new build.')
    .action(async () => {
      const options = setOptions(program.optsWithGlobals())
      const client = await createGrpcClient(options)
      const buildid = await client.GetNextBuildId()
      console.log({ buildid: buildid.id })
    })

  program
    .command('upload')
    .description('Uploads a new build to the AppDistrib server.')
    .argument('<file>', 'The file to upload.')
    .action(async (fileName) => {
      const path = require('node:path')
      const options = setOptions(program.optsWithGlobals())
      const client = await createGrpcClient(options)
      const { sha3_256 } = require('@noble/hashes/sha3')
      const hash = sha3_256.create()
      const digest = new Uint8Array(32)
      let lengthProgress = 0
      const fileSize = (await fs.stat(fileName)).size
      let manifest = null
      if (options.manifest) {
        manifest = await fs.readJson(options.manifest)
      }
      const call = client.NewBuild()
      call.write({
        header: {
          buildId: options.buildid ? { id: options.buildid } : undefined,
          keep: options.keep,
          fileSize,
          filename: path.basename(fileName),
          manifest: JSON.stringify(manifest)
        }
      })
      const bar = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      )
      bar.start(fileSize, 0)
      const callData = {}
      call.on('data', async (payload) => {
        switch (payload.response) {
          case 'buildId':
            callData.buildId = payload.buildId?.buildId?.id
            {
              const file = await fs.createReadStream(fileName)
              file
                .on('readable', async () => {
                  const data = await file.read()
                  if (data) {
                    bar.update((lengthProgress += data.length))
                    hash.update(data)
                    call.write({ chunk: { data } })
                  }
                })
                .on('end', () => {
                  hash.digestInto(digest)
                  call.write({ footer: { hash: digest } })
                  call.end()
                })
            }
            break
          case 'key':
            if (!callData.buildId) {
              throw new Error('No buildId received from server')
            }
            callData.key = payload.key?.key
            bar.stop()
            console.log(
              'Upload of file %s has completed successfully.\nHash: %s\nKey: %s\nServer is publishing build %s.',
              path.basename(fileName),
              Buffer.from(digest).toString('hex'),
              callData.key,
              callData.buildId
            )
            break
        }
      })
      call.on('error', (err) => {
        bar.stop()
        throw err
      })
    })

  program.parse()
}

main()
  .then((ret) => process.exit)
  .catch((err) => {
    throw err
  })
