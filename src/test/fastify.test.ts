/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test'
import { deepStrictEqual } from 'node:assert'
import fastify, { FastifyRequest } from 'fastify'
import { testLogger } from './helpers/testLogger'
import { opaAuthTransformer } from '../lib'
import { makeExecutableSchema } from '@graphql-tools/schema'
import fs from 'node:fs'
import path from 'node:path'
import { ApolloServer } from '@apollo/server'

import { MockAgent, setGlobalDispatcher } from 'undici'
import sinon from 'sinon'
import { MockInterceptor } from 'undici-types/mock-interceptor'

import fastifyApollo, {
  fastifyApolloDrainPlugin,
} from '@as-integrations/fastify'
import { OpenPolicyAgentClient } from '@treedom/opa-client-sdk'
import { createGraphqlTestClient } from './helpers/graphqlTestClient'

const mockAgent = new MockAgent()
mockAgent.disableNetConnect()
setGlobalDispatcher(mockAgent)

type ApolloContext = {
  request: FastifyRequest
}

const typeDefs = `#graphql
  ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}
  
  type Query {
    ping(message: String!): String! @opa(path: "query/ping", options: { bar: "foo", baz: 123, qux: true, bing: { bong: "doo" }, fl: 1.34, n: null, arr: [{a: "b"}, {c: "d"}] })
  }
`

const resolvers = {
  Query: {
    ping: (source, args) => args.message,
  },
}

const app = fastify({ logger: testLogger })

const opaClient = new OpenPolicyAgentClient({
  url: 'http://opa.test:3000',
})

const schema = opaAuthTransformer(opaClient, {
  requestContextField: 'request',
})(makeExecutableSchema({ typeDefs, resolvers }))

const apolloServer = new ApolloServer<ApolloContext>({
  schema,
  plugins: [fastifyApolloDrainPlugin(app)],
  includeStacktraceInErrorResponses: false,
})

test('should set a different context field name', async (t) => {
  await apolloServer.start()

  app.log.debug({}, 'Apollo Server plugin loaded')

  // build context function
  await app.register(fastifyApollo(apolloServer), {
    context: async (request) => {
      return {
        request,
      }
    },
  })

  const opaPolicyMock = sinon
    .stub<never, ReturnType<MockInterceptor.MockReplyOptionsCallback>>()
    .returns({
      statusCode: 200,
      data: { result: true },
      responseOptions: { headers: { 'Content-Type': 'application/json' } },
    })

  mockAgent
    .get('http://opa.test:3000')
    .intercept({
      path: '/v1/data/query/ping',
      method: 'POST',
      body: (body) => {
        t.test('should pass headers to opa body request', async () => {
          deepStrictEqual(JSON.parse(body), {
            input: {
              args: {
                message: 'pong',
              },
              headers: {
                'content-length': '103',
                'content-type': 'application/json; charset=utf-8',
                'user-agent': 'lightMyRequest',
                authorization: 'Bearer xxx.yyy.zzz',
                cookie: '',
                host: 'localhost:80',
              },
              options: {
                arr: [
                  {
                    a: 'b',
                  },
                  {
                    c: 'd',
                  },
                ],
                bar: 'foo',
                baz: 123,
                bing: {
                  bong: 'doo',
                },
                fl: 1.34,
                n: null,
                qux: true,
              },
            },
          })
        })

        return true
      },
    })
    .reply(opaPolicyMock)

  const testClient = createGraphqlTestClient(app)
  const response = await testClient.query(
    `#graphql
      query { ping(message: "pong") }
    `,
    {
      headers: {
        authorization: 'Bearer xxx.yyy.zzz',
      },
    }
  )

  deepStrictEqual(response, { data: { ping: 'pong' } })
})
