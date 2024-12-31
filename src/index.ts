import { WebhookEvent } from '@octokit/webhooks-types'
import io from '@pm2/io'
import { exec, spawn } from 'child_process'
import { Console } from 'console'
import { createHmac } from 'crypto'
import fastify from 'fastify'
import rawBody from 'fastify-raw-body'
import { readFile } from 'fs/promises'
import _, { xor } from 'lodash'
import path from 'path'
import pm2 from 'pm2'
import { fileURLToPath } from 'url'
import { promisify } from 'util'

const config = (io.getConfig() as any).module_conf

const server = fastify()

await server.register(rawBody)

const execAsync = promisify(exec)

const reloadAsync = promisify(pm2.reload.bind(pm2))

await new Promise<void>((resolve, reject) => {
  pm2.connect((err) => {
    if (err) return reject(err)
    resolve()
  })
})

const port = config.port ?? 9876

const urlScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'repo-url.sh',
)

server.post('/', async (req, reply) => {
  const secret = 'sha256=' + createHmac('sha256', config.secret).update(req.rawBody!).digest('hex')

  if (req.headers['x-hub-signature-256'] !== secret)
    return reply.status(400).send(new Error('Invalid signature'))

  reply.status(204).send()

  try {
    const ev = req.body as WebhookEvent

    if ('zen' in ev) {
      console.log(`Ping from ${ev.repository?.full_name}: ${ev.zen}`)
      return
    }

    if ('ref' in ev && 'before' in ev) {
      const processes = (
        await new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
          pm2.list((err, value) => {
            if (err) return reject(err)
            resolve(value)
          })
        })
      ).map((x) => {
        const ver = (x.pm2_env as any)?.versioning
        return {
          id: x.pm_id,
          cwd: x.pm2_env?.pm_cwd,
          url: ver?.url,
          rev: ver?.revision,
        }
      })

      const toReload = (
        await Promise.all(
          processes.map(async (x) => {
            try {
              const urls = [
                ev.repository.git_url,
                ev.repository.ssh_url,
                ev.repository.clone_url,
                ev.repository.svn_url,
              ]
              if (!urls.includes(x.url)) {
                console.debug(
                  `Skipping ${x.url}: url does not match with webhook(${urls.join(', ')})`,
                )
                return null
              }
              if (x.rev === ev.head_commit?.id) {
                console.debug(
                  `Skipping ${x.url}: rev not changed (current: ${x.rev}, in webhook: ${ev.head_commit?.id})`,
                )
                return null
              }
              return { id: x.id, path: x.cwd }
            } catch (e) {
              return null
            }
          }),
        )
      ).filter((x) => !!x) as unknown[] as { id: string; path: string }[]

      console.log('Trying to pull:', toReload)

      for (const p of toReload) {
        try {
          console.log(`>>>>>>>>>> Reload process ${p.id} <<<<<<<<<<`)

          const pkgJson = await readFile(path.join(p.path, 'package.json'))
            .then((x) => x.toString())
            .catch(() => null)

          const res = await execAsync('git pull', { cwd: p.path })

          console.log(res.stdout.trim())

          if (res.stderr.trim()) {
            console.error(res.stderr.trim())
          }

          const pkgJson2 = await readFile(path.join(p.path, 'package.json'))
            .then((x) => x.toString())
            .catch(() => null)

          if (pkgJson && pkgJson2 && pkgJson !== pkgJson2) {
            console.log('package.json update detected. running install...')

            const pkgJsonParsed = JSON.parse(pkgJson2)

            const installScript = pkgJsonParsed.scripts?.autoReloadInstall ?? 'npm install'

            const installOuptut = await execAsync(installScript, { cwd: p.path })

            console.log(installOuptut.stdout.trim())

            if (installOuptut.stderr.trim()) {
              console.error(installOuptut.stderr.trim())
            }
          }

          if (pkgJson2) {
            const pkgJsonParsed = JSON.parse(pkgJson2)
            const buildScript = pkgJsonParsed.scripts?.autoUpdateBuild
            if (buildScript) {
              console.log('build script detected. running...')
              const buildOutput = await execAsync(buildScript, { cwd: p.path })

              console.log(buildOutput.stdout.trim())
              if (buildOutput.stderr.trim()) {
                console.error(buildOutput.stderr.trim())
              }
            }
          }

          console.log(`Successfully pulled process ${p.id}. Reloading...`)

          await reloadAsync(p.id)

          console.log(`Reloaded ${p.id}`)
        } catch (e) {
          console.error('Failed to pull and reload:', e)
        }
      }
    }
  } catch (e) {
    console.error(e)
  }
})

console.log(
  `Listening on ${await server.listen({
    host: '0.0.0.0',
    port,
  })}`,
)
