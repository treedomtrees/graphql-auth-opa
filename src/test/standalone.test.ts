/* eslint-disable @typescript-eslint/no-explicit-any */
import { after, before, test } from 'node:test'
import { deepStrictEqual, doesNotThrow } from 'node:assert'

import { opaAuthTransformer } from '../lib'
import { makeExecutableSchema } from '@graphql-tools/schema'
import fs from 'node:fs'
import path from 'node:path'
import { ApolloServer } from '@apollo/server'
import { startStandaloneServer } from '@apollo/server/standalone'

import { MockAgent, setGlobalDispatcher } from 'undici'
import sinon from 'sinon'
import { MockInterceptor } from 'undici-types/mock-interceptor'

import { OpenPolicyAgentClient } from '@treedom/opa-client-sdk'
import { request } from 'undici'
import { IncomingMessage } from 'node:http'

const mockAgent = new MockAgent()
// Should not disable netConnect in order to call localhost standalone server
setGlobalDispatcher(mockAgent)

type ApolloContext = {
  request: IncomingMessage
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

const opaClient = new OpenPolicyAgentClient({
  url: 'http://opa.test:3000',
})

const schema = opaAuthTransformer(opaClient, {
  requestContextField: 'request',
})(makeExecutableSchema({ typeDefs, resolvers }))

const apolloServer = new ApolloServer<ApolloContext>({
  schema,
  includeStacktraceInErrorResponses: false,
})

let standaloneServer: { url: string }

before(async () => {
  standaloneServer = await startStandaloneServer(apolloServer, {
    listen: { port: 50012 },
    context: async ({ req }) => {
      return {
        request: req,
      }
    },
  })
})

after(async () => {
  await apolloServer.stop()
})

test('should set a different context field name', async (t) => {
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
                'content-length': '67',
                'content-type': 'application/json',
                authorization: 'Bearer xxx.yyy.zzz',
                connection: 'keep-alive',
                host: 'localhost:50012',
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

  const response = await request(standaloneServer.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer xxx.yyy.zzz',
    },
    body: JSON.stringify({
      query: `#graphql
      query { ping(message: "pong") }
    `,
    }),
  })

  const data = await response.body.json()

  doesNotThrow(
    () => mockAgent.assertNoPendingInterceptors(),
    'all request interceptors should have been called'
  )

  deepStrictEqual(data, { data: { ping: 'pong' } })
})
