/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, test } from 'node:test'
import { deepEqual, strictEqual } from 'node:assert'
import { opaAuthTransformer } from '../lib'
import fs from 'node:fs'
import path from 'node:path'

import { makeExecutableSchema } from '@graphql-tools/schema'
import { IResolvers } from '@graphql-tools/utils'
import { ApolloServer } from '@apollo/server'

import { MockAgent, setGlobalDispatcher } from 'undici'
import { MockInterceptor } from 'undici-types/mock-interceptor'
import sinon from 'sinon'

import { OpenPolicyAgentClient } from '@treedom/opa-client-sdk'

const mockAgent = new MockAgent()
mockAgent.disableNetConnect()
setGlobalDispatcher(mockAgent)

const createApolloServer = async (
  typeDefs: string,
  resolvers: IResolvers<any, any>
) => {
  const opaClient = new OpenPolicyAgentClient({
    url: 'http://opa.test:3000',
  })

  const schema = opaAuthTransformer(opaClient)(
    makeExecutableSchema({ typeDefs, resolvers })
  )

  const apolloServer = new ApolloServer({
    schema,
    includeStacktraceInErrorResponses: false,
  })

  await apolloServer.start()

  return apolloServer
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
beforeEach(() => {
  mockAgent.removeAllListeners()
})

test('http headers should be forwarded to opa', async () => {})

test('unauthenticated query should succeed', async () => {
  const schema = `#graphql
    ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}

    type Query {
      ping(message: String!): String!
    }
  `

  const app = await createApolloServer(schema, {
    Query: {
      ping: (source, args) => args.message,
    },
  })

  const response = await app.executeOperation({
    query: `#graphql
    query { ping(message: "pong") }
  `,
  })

  strictEqual(response.body.kind, 'single')
  deepEqual(response.body.singleResult, {
    data: { ping: 'pong' },
    errors: undefined,
  })
})

test('authenticated query should succeed', async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}
  
  type Query {
    ping(message: String!): String! @opa(path: "query/ping", options: { bar: "foo", baz: 123, qux: true, bing: { bong: "doo" }, fl: 1.34, n: null, arr: [{a: "b"}, {c: "d"}] })
  }
`
  const app = await createApolloServer(schema, {
    Query: {
      ping: (source, args) => args.message,
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
    })
    .reply(opaPolicyMock)

  const response = await app.executeOperation({
    query: `#graphql
    query { ping(message: "pong") }
  `,
  })

  strictEqual(response.body.kind, 'single')
  deepEqual(response.body.singleResult, {
    data: { ping: 'pong' },
    errors: undefined,
  })

  const body = JSON.parse(opaPolicyMock.firstCall?.firstArg?.body)

  deepEqual(body?.input?.args, { message: 'pong' })
  deepEqual(body?.input?.options, {
    bar: 'foo',
    baz: 123,
    qux: true,
    bing: { bong: 'doo' },
    fl: 1.34,
    n: null,
    arr: [{ a: 'b' }, { c: 'd' }],
  })
})

test('authenticated query should fail', async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}
  type Query {
      ping(message: String!): String! @opa(path: "query/ping")
  }
  `

  const app = await createApolloServer(schema, {
    Query: {
      ping: (source, args) => args.message,
    },
  })

  mockAgent
    .get('http://opa.test:3000')
    .intercept({
      path: '/v1/data/query/ping',
      method: 'POST',
    })
    .reply(
      200,
      { result: false },
      { headers: { 'Content-Type': 'application/json' } }
    )

  const response = await app.executeOperation({
    query: `#graphql
    query { ping(message: "pong") }
  `,
  })

  strictEqual(response.body.kind, 'single')
  deepEqual(response.body.singleResult, {
    data: null,
    errors: [
      {
        extensions: {
          code: 'NOT_AUTHORIZED',
        },
        locations: [
          {
            column: 13,
            line: 2,
          },
        ],
        message: 'Not authorized',
        path: ['ping'],
      },
    ],
  })
})

test('authenticated query should succeed when opa path starts with slash', async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}
  type Query {
    ping(message: String!): String! @opa(path: "query/ping", options: { bar: "foo", baz: 123, qux: true, bing: { bong: "doo" }, fl: 1.34, n: null, arr: [{a: "b"}, {c: "d"}] })
  }
  `

  const app = await createApolloServer(schema, {
    Query: {
      ping: (source, args) => args.message,
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
    })
    .reply(opaPolicyMock)

  const response = await app.executeOperation({
    query: `#graphql
      query { ping(message: "pong") }
    `,
  })

  strictEqual(response.body.kind, 'single')
  deepEqual(response.body.singleResult, {
    data: { ping: 'pong' },
    errors: undefined,
  })

  const body = JSON.parse(opaPolicyMock.firstCall?.firstArg?.body)

  deepEqual(body?.input?.args, { message: 'pong' })
  deepEqual(body?.input?.options, {
    bar: 'foo',
    baz: 123,
    qux: true,
    bing: { bong: 'doo' },
    fl: 1.34,
    n: null,
    arr: [{ a: 'b' }, { c: 'd' }],
  })
})

test('authenticated query should fail when opa throws', async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, '../lib/opaAuthDirective.gql'), 'utf-8')}
  type Query {
      ping(message: String!): String! @opa(path: "query/ping")
  }
  `

  const app = await createApolloServer(schema, {
    Query: {
      ping: (source, args) => args.message,
    },
  })

  mockAgent
    .get('http://opa.test:3000')
    .intercept({
      path: '/v1/data/query/ping',
      method: 'POST',
    })
    .reply(
      400,
      { warning: { code: 'invalid input' } },
      { headers: { 'Content-Type': 'application/json' } }
    )

  const response = await app.executeOperation({
    query: `#graphql
    query { ping(message: "pong") }
  `,
  })

  strictEqual(response.body.kind, 'single')
  deepEqual(response.body.singleResult, {
    data: null,
    errors: [
      {
        extensions: {
          code: 'NOT_AUTHORIZED',
        },
        locations: [
          {
            column: 13,
            line: 2,
          },
        ],
        message: 'Internal Server Error',
        path: ['ping'],
      },
    ],
  })
})
