'use strict'

const fs = require('fs-extra')
const path = require('node:path')
const temp = require('temp').track()

const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const base85 = require('base85')
const { CRC32Stream } = require('crc32-stream')
const MD5 = require('md5.js')
const { sha1 } = require('@noble/hashes/sha1')
const { sha3_256 } = require('@noble/hashes/sha3')
const { hmac } = require('@noble/hashes/hmac')

function errorToStatus (err, code = grpc.status.INTERNAL) {
  return { code, details: JSON.stringify(err, Object.getOwnPropertyNames(err)) }
}

exports.setService = async (server) => {
  const pkgDefinition = await protoLoader.load(
    path.join(__dirname, '..', '..', 'client', 'appdistrib.proto'),
    { oneofs: true }
  )
  const pkg = grpc.loadPackageDefinition(pkgDefinition)

  async function getProjectAndOrganization (call, callData) {
    if (callData.project) {
      return callData.project
    }
    const tokenArray = call.metadata.get('token')
    const hasOneToken = tokenArray.length === 1
    const hasZeroOrOneToken = tokenArray.length <= 1
    const organizationIDArray = call.metadata.get('organization')
    const hasOneOrganization = organizationIDArray.length === 1
    const projectIdArray = call.metadata.get('project')
    const hasOneProject = projectIdArray.length === 1
    if (!hasZeroOrOneToken || !hasOneOrganization || !hasOneProject) {
      throw new Error('Missing or incorrect metadata')
    }
    const organizationID = organizationIDArray[0]
    const projectId = projectIdArray[0]
    const organization = await server.schemas.findOrganization(organizationID)
    if (!organization) {
      throw new Error('Organization not found')
    }
    const project = await server.schemas.findProject({
      id: projectId,
      organization
    })
    if (!project) {
      throw new Error('Project not found')
    }
    callData.tokenValid = false
    if (hasOneToken) {
      callData.tokenValid = await server.schemas.validateProjectFromToken({
        secretKey: server.config.secretKey,
        token: tokenArray[0],
        project
      })
    }
    callData.organization = organization
    callData.project = project
  }

  async function getNextBuildId (call, callData = {}) {
    await getProjectAndOrganization(call, callData)
    const buildID = await server.schemas.getNextBuildId(callData.project)
    return buildID
  }

  const keepaliveOptions = {
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 1_000,
    'grpc.keepalive_permit_without_calls': 1
  }

  const grpcServer = new grpc.Server(keepaliveOptions)
  grpcServer.addService(pkg.appdistrib.AppDistrib.service, {
    GetNextBuildId: async (call, callback) => {
      try {
        callback(null, { id: await getNextBuildId(call) })
      } catch (err) {
        callback(err)
      }
    },
    NewBuild: async (call) => {
      const callData = {}
      try {
        await getProjectAndOrganization(call, callData)
      } catch (err) {
        console.error(err)
        call.emit('error', errorToStatus(err))
        return
      }
      if (!callData.tokenValid) {
        call.emit(
          'error',
          errorToStatus(new Error('Invalid token'), grpc.status.UNAUTHENTICATED)
        )
        return
      }
      callData.payloadSize = 0
      callData.tmpFile = temp.createWriteStream()
      callData.hashes = {
        crc32: new CRC32Stream(),
        md5: new MD5(),
        sha1: sha1.create(),
        sha3: sha3_256.create(),
        key: hmac.create(sha3_256, server.config.storage.secretKey)
      }
      call.on('data', async (payload) => {
        try {
          switch (payload.info) {
            case 'header': {
              if (callData.gotHeader) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Header already received'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              callData.gotHeader = true
              callData.clientInfo = {}
              callData.clientInfo.buildId =
                payload.header?.buildId?.id ||
                (await getNextBuildId(call, callData))
              callData.clientInfo.fileSize = payload.header?.fileSize
              callData.clientInfo.keep = payload.header?.keep
              callData.clientInfo.filename = payload.header?.filename
              callData.clientInfo.manifest = JSON.parse(
                payload.header?.manifest
              )
              callData.clientInfo.changelog = payload.header?.changelog
              callData.sentBuild = true
              if (callData.clientInfo.filename.split('/').length > 1) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Invalid filename'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              const build = await server.schemas.getBuild({
                project: callData.project,
                id: callData.clientInfo.buildId
              })
              if (build) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Build ID already exists'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              call.write({
                buildId: { buildId: { id: callData.clientInfo.buildId } }
              })
              break
            }
            case 'chunk': {
              if (!callData.gotHeader) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Received chunk without header first'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              if (!callData.sentBuild) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Received chunk without having sent build ID'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              callData.gotChunk = true
              if (!Buffer.isBuffer(payload.chunk?.data)) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Chunk data not provided'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
                break
              }
              callData.payloadSize += payload.chunk.data.length
              callData.hashes.crc32.write(payload.chunk.data)
              callData.hashes.md5.update(payload.chunk.data)
              callData.hashes.sha1.update(payload.chunk.data)
              callData.hashes.sha3.update(payload.chunk.data)
              callData.hashes.key.update(payload.chunk.data)
              callData.tmpFile.write(payload.chunk.data)
              call.write({ chunkAck: {} })
              break
            }
            case 'footer': {
              if (callData.gotFooter) {
                call.emit(
                  'error',
                  errorToStatus(new Error('Footer already received')),
                  grpc.status.INVALID_ARGUMENT
                )
                break
              }
              if (!callData.gotHeader || !callData.gotChunk) {
                call.emit(
                  'error',
                  errorToStatus(new Error('Header or chunk not received')),
                  grpc.status.INVALID_ARGUMENT
                )
                break
              }
              callData.gotFooter = true
              {
                callData.hashes.crc32.end()
                const crc32 = callData.hashes.crc32.digest()
                const md5 = callData.hashes.md5.digest()
                const sha1 = Buffer.from(callData.hashes.sha1.digest())
                const sha3 = Buffer.from(callData.hashes.sha3.digest())
                const key = Buffer.from(callData.hashes.key.digest())
                callData.hashes = { crc32, md5, sha1, sha3, key }
              }
              callData.clientInfo.hash = payload.footer?.hash
              if (!Buffer.isBuffer(callData.clientInfo.hash)) {
                call.emit(
                  'error',
                  errorToStatus(
                    new Error('Hash not provided'),
                    grpc.status.INVALID_ARGUMENT
                  )
                )
              }
              break
            }
            default: {
              call.emit(
                'error',
                errorToStatus(
                  new Error('Invalid payload type'),
                  grpc.status.INVALID_ARGUMENT
                )
              )
              break
            }
          }
        } catch (err) {
          console.error(err)
          call.emit('error', errorToStatus(err))
        }
      })
      call.on('end', async () => {
        try {
          if (
            !callData.gotHeader ||
            !callData.gotChunk ||
            !callData.gotFooter
          ) {
            call.emit(
              'error',
              errorToStatus(
                new Error('Header, chunk, or footer not received'),
                grpc.status.INVALID_ARGUMENT
              )
            )
          } else if (!callData.clientInfo.hash.equals(callData.hashes.sha3)) {
            call.emit(
              'error',
              errorToStatus(
                new Error('Asset hash mismatch'),
                grpc.status.INVALID_ARGUMENT
              )
            )
          } else if (callData.clientInfo.fileSize !== callData.payloadSize) {
            call.emit(
              'error',
              errorToStatus(
                new Error('File size mismatch'),
                grpc.status.INVALID_ARGUMENT
              )
            )
          } else {
            callData.tmpFile.end()
            const tmpPath = callData.tmpFile.path
            callData.tmpFile = undefined
            await server.moveAsset(
              tmpPath,
              callData.clientInfo.filename,
              callData.hashes.key
            )
            const newBuild = await server.schemas.createBuild({
              project: callData.project,
              id: callData.clientInfo.buildId,
              manifest: callData.clientInfo.manifest,
              assetId: callData.hashes.key.toString('hex'),
              filename: callData.clientInfo.filename,
              hashes: callData.hashes,
              size: callData.payloadSize,
              keep: callData.clientInfo.keep
            })
            await server.generateBuildManifest(newBuild, callData.project)
            await server.generateBuildChangelog(
              newBuild,
              callData.project,
              callData.clientInfo.changelog
            )
            await server.generateProjectManifest(
              callData.project,
              callData.organization
            )
            call.write({
              key: { key: base85.encode(callData.hashes.key) }
            })
            call.end()
          }
        } catch (err) {
          console.error(err)
          call.emit('error', errorToStatus(err))
        }
      })
      call.on('cancelled', () => {
        try {
          if (callData.tmpFile) {
            callData.tmpFile.end()
            fs.remove(callData.tmpFile.path)
          }
        } catch (err) {
          console.error(err)
          call.emit('error', errorToStatus(err))
        }
      })
    },
    GenerateManifestsForProject: async (call, callback) => {
      try {
        const tokenArray = call.metadata.get('token')
        if (tokenArray.length !== 1) {
          throw new Error('Missing or incorrect metadata')
        }
        const token = tokenArray[0]
        const organizationIDArray = call.metadata.get('organization')
        if (organizationIDArray.length !== 1) {
          throw new Error('Missing or incorrect metadata')
        }
        const organizationID = organizationIDArray[0]
        const organization = await server.schemas.findOrganization(organizationID)
        if (!organization) {
          throw new Error('Organization not found')
        }
        const projectIDArray = call.metadata.get('project')
        if (projectIDArray.length !== 1) {
          throw new Error('Missing or incorrect metadata')
        }
        const projectID = projectIDArray[0]
        const project = await server.schemas.findProject({
          id: projectID,
          organization
        })
        if (!project) {
          throw new Error('Project not found')
        }
        const tokenValid = await server.schemas.validateProjectFromToken({
          secretKey: server.config.secretKey,
          token,
          project
        })
        if (!tokenValid) {
          call.emit(
            'error',
            errorToStatus(new Error('Invalid token'), grpc.status.UNAUTHENTICATED)
          )
          return
        }
        const builds = await server.schemas.listBuilds(project)
        for (const build of builds) {
          await server.generateBuildManifest(build, project)
        }
        await server.generateProjectManifest(project, organization)
        callback(null, {})
      } catch (err) {
        console.error(err)
        callback(err)
      }
    }
  })
  return [
    new Promise((resolve, reject) => {
      grpcServer.bindAsync(
        `${server.config.grpcConfig.host}:${server.config.grpcConfig.port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err !== null) {
            reject(err)
          }
          console.log(`gRPC server bound on port ${port}`)
          resolve(port)
        }
      )
    })
  ]
}
