const fastify = require('fastify')
const { asClass, Lifetime } = require('awilix')
const { fastifyAwilixPlugin, diContainer } = require('../lib')
const {
  fastifyAwilixPlugin: fastifyAwilixPluginClassic,
  diContainer: diContainerClassic,
} = require('../lib/classic')

class UserRepository {
  constructor() {
    this.disposeCounter = 0
  }

  dispose() {
    this.disposeCounter++
  }
}

let storedUserRepository
let storedUserRepositoryScoped

const variations = [
  {
    name: 'PROXY',
    plugin: fastifyAwilixPlugin,
    container: diContainer,
  },
  {
    name: 'CLASSIC',
    plugin: fastifyAwilixPluginClassic,
    container: diContainerClassic,
  },
]

describe('fastifyAwilixPlugin', () => {
  let app
  afterEach(() => {
    return app.close()
  })

  variations.forEach((variation) => {
    describe(variation.name, () => {
      const endpoint = async (req, res) => {
        const userRepository = app.diContainer.resolve('userRepository')
        storedUserRepository = userRepository
        expect(userRepository.disposeCounter).toEqual(0)

        res.send({
          status: 'OK',
        })
      }

      describe('dispose singletons', () => {
        const endpointWithScope = async (req, res) => {
          const userRepository = req.diScope.resolve('userRepository')
          const userRepositoryScoped = req.diScope.resolve('userRepositoryScoped')
          storedUserRepository = userRepository
          storedUserRepositoryScoped = userRepositoryScoped
          expect(userRepository.disposeCounter).toEqual(0)
          expect(userRepositoryScoped.disposeCounter).toEqual(0)

          res.send({
            status: 'OK',
          })
        }

        it('dispose app-scoped singletons on closing app correctly', async () => {
          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: true, disposeOnResponse: false })
          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })

          app.post('/', endpoint)
          await app.ready()

          const response = await app.inject().post('/').end()
          expect(response.statusCode).toEqual(200)
          expect(storedUserRepository.disposeCounter).toEqual(0)

          await app.close()
          expect(storedUserRepository.disposeCounter).toEqual(1)
        })

        it('do not dispose app-scoped singletons on sending response', async () => {
          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: false, disposeOnResponse: true })
          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })

          app.post('/', endpoint)
          await app.ready()

          const response = await app.inject().post('/').end()
          expect(response.statusCode).toEqual(200)
          expect(storedUserRepository.disposeCounter).toEqual(0)

          await app.close()
          expect(storedUserRepository.disposeCounter).toEqual(0)
        })

        it('dispose request-scoped singletons on sending response', async () => {
          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: false, disposeOnResponse: true })

          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })
          app.addHook('onRequest', (request, reply, done) => {
            request.diScope.register({
              userRepositoryScoped: asClass(UserRepository, {
                lifetime: Lifetime.SCOPED,
                dispose: (service) => service.dispose(),
              }),
            })
            done()
          })

          app.post('/', endpointWithScope)
          await app.ready()

          const response = await app.inject().post('/').end()
          expect(response.statusCode).toEqual(200)
          expect(storedUserRepositoryScoped.disposeCounter).toEqual(1)
          expect(storedUserRepository.disposeCounter).toEqual(0)

          await app.close()
          expect(storedUserRepositoryScoped.disposeCounter).toEqual(1)
          expect(storedUserRepository.disposeCounter).toEqual(0)
        })

        it('do not dispose request-scoped singletons twice on closing app', async () => {
          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: true, disposeOnResponse: true })

          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })
          app.addHook('onRequest', (request, reply, done) => {
            request.diScope.register({
              userRepositoryScoped: asClass(UserRepository, {
                lifetime: Lifetime.SCOPED,
                dispose: (service) => service.dispose(),
              }),
            })
            done()
          })

          app.post('/', endpointWithScope)
          await app.ready()

          const response = await app.inject().post('/').end()
          expect(response.statusCode).toEqual(200)
          expect(storedUserRepositoryScoped.disposeCounter).toEqual(1)
          expect(storedUserRepository.disposeCounter).toEqual(0)

          await app.close()
          expect(storedUserRepositoryScoped.disposeCounter).toEqual(1)
          expect(storedUserRepository.disposeCounter).toEqual(1)
        })
      })

      describe('response logging', () => {
        it('should only produce one "request completed" log with dispose settings enabled', async () => {
          let requestCompletedLogCount = 0
          jest.spyOn(process.stdout, 'write').mockImplementation((data) => {
            const log = JSON.parse(data)
            if (log.msg === 'request completed') requestCompletedLogCount += 1
            return true
          })

          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: true, disposeOnResponse: true })
          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })

          app.post('/', endpoint)
          await app.ready()

          await app.inject().post('/').end()

          await app.close()
          expect(requestCompletedLogCount).toEqual(1)
        })

        it('should only produce one "request completed" log with dispose settings disabled', async () => {
          let requestCompletedLogCount = 0
          jest.spyOn(process.stdout, 'write').mockImplementation((data) => {
            const log = JSON.parse(data)
            if (log.msg === 'request completed') requestCompletedLogCount += 1
            return true
          })

          app = fastify({ logger: true })
          app.register(variation.plugin, { disposeOnClose: false, disposeOnResponse: false })
          variation.container.register({
            userRepository: asClass(UserRepository, {
              lifetime: Lifetime.SINGLETON,
              dispose: (service) => service.dispose(),
            }),
          })

          app.post('/', endpoint)
          await app.ready()

          await app.inject().post('/').end()

          await app.close()
          expect(requestCompletedLogCount).toEqual(1)
        })
      })
    })
  })
})
