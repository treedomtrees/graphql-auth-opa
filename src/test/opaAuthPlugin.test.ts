import { beforeEach, test } from "node:test";
import { deepStrictEqual } from "node:assert";
import fastify from "fastify";
import { testLogger } from "./helpers/testLogger";
import { opaAuthTransformer } from "../lib";
import { makeExecutableSchema } from "@graphql-tools/schema";
import fs from "node:fs";
import path from "node:path";
import { ApolloServer } from "@apollo/server";

import { MockAgent, setGlobalDispatcher } from "undici";
import sinon from "sinon";
import { MockInterceptor } from "undici-types/mock-interceptor";

import fastifyApollo, {
  fastifyApolloDrainPlugin
} from "@as-integrations/fastify";
import { IResolvers } from "@graphql-tools/utils";
import { createGraphqlTestClient } from "./helpers/graphqlTestClient";
import { OpenPolicyAgentClient } from "@treedom/opa-client-sdk";
import { IncomingMessage } from "node:http";

type ApolloContext = {
  req: IncomingMessage;
};

const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
setGlobalDispatcher(mockAgent);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createApp = async (typeDefs: string, resolvers: IResolvers<any, any>) => {
  const app = fastify({ logger: testLogger });

  const opaClient = new OpenPolicyAgentClient({
    url: "http://opa.test:3000"
  });

  const schema = opaAuthTransformer(
    opaClient,
    app.log
  )(makeExecutableSchema({ typeDefs, resolvers }));

  const apolloServer = new ApolloServer<ApolloContext>({
    schema,
    plugins: [fastifyApolloDrainPlugin(app)],
    includeStacktraceInErrorResponses: false
  });

  await apolloServer.start();

  app.log.debug({}, "Apollo Server plugin loaded");

  // build context function
  await app.register(fastifyApollo(apolloServer), {
    context: async (req, repl) => {
      return {
        req: req.raw
      };
    }
  });

  return app;
};

beforeEach(() => {
  mockAgent.removeAllListeners();
});

test("unauthenticated query should succeed", async () => {
  const schema = `#graphql
    ${fs.readFileSync(path.join(__dirname, "../lib/opaAuthDirective.gql"), "utf-8")}

    type Query {
      ping(message: String!): String!
    }
  `;

  const app = await createApp(schema, {
    Query: {
      ping: (source, args) => args.message
    }
  });

  const testClient = createGraphqlTestClient(app);
  const response = await testClient.query(`#graphql
    query { ping(message: "pong") }
  `);

  deepStrictEqual(response, { data: { ping: "pong" } });
});

test("authenticated query should succeed", async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, "../lib/opaAuthDirective.gql"), "utf-8")}
  
  type Query {
    ping(message: String!): String! @opa(path: "query/ping", options: { bar: "foo", baz: 123, qux: true, bing: { bong: "doo" }, fl: 1.34, n: null, arr: [{a: "b"}, {c: "d"}] })
  }
`;
  const app = await createApp(schema, {
    Query: {
      ping: (source, args) => args.message
    }
  });

  const opaPolicyMock = sinon
    .stub<never, ReturnType<MockInterceptor.MockReplyOptionsCallback>>()
    .returns({
      statusCode: 200,
      data: { result: true },
      responseOptions: { headers: { "Content-Type": "application/json" } }
    });

  mockAgent
    .get("http://opa.test:3000")
    .intercept({
      path: "/v1/data/query/ping",
      method: "POST"
    })
    .reply(opaPolicyMock);

  const testClient = createGraphqlTestClient(app);
  const response = await testClient.query(`#graphql
    query { ping(message: "pong") }
  `);

  deepStrictEqual(response, { data: { ping: "pong" } });

  const body = JSON.parse(opaPolicyMock.firstCall?.firstArg?.body);

  deepStrictEqual(body?.input?.args, { message: "pong" });
  deepStrictEqual(body?.input?.options, {
    bar: "foo",
    baz: 123,
    qux: true,
    bing: { bong: "doo" },
    fl: 1.34,
    n: null,
    arr: [{ a: "b" }, { c: "d" }]
  });
});

test("authenticated query should fail", async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, "../lib/opaAuthDirective.gql"), "utf-8")}
  type Query {
      ping(message: String!): String! @opa(path: "query/ping")
  }
  `;

  const app = await createApp(schema, {
    Query: {
      ping: (source, args) => args.message
    }
  });

  mockAgent
    .get("http://opa.test:3000")
    .intercept({
      path: "/v1/data/query/ping",
      method: "POST"
    })
    .reply(
      200,
      { result: false },
      { headers: { "Content-Type": "application/json" } }
    );

  const testClient = createGraphqlTestClient(app);
  const response = await testClient.query(`#graphql
    query { ping(message: "pong") }
  `);

  deepStrictEqual(response, {
    data: null,
    errors: [
      {
        extensions: {
          code: "NOT_AUTHORIZED"
        },
        locations: [
          {
            column: 13,
            line: 2
          }
        ],
        message: "Not authorized",
        path: ["ping"]
      }
    ]
  });
});

test("authenticated query should succeed when opa path starts with slash", async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, "../lib/opaAuthDirective.gql"), "utf-8")}
  type Query {
    ping(message: String!): String! @opa(path: "query/ping", options: { bar: "foo", baz: 123, qux: true, bing: { bong: "doo" }, fl: 1.34, n: null, arr: [{a: "b"}, {c: "d"}] })
  }
  `;

  const app = await createApp(schema, {
    Query: {
      ping: (source, args) => args.message
    }
  });

  const opaPolicyMock = sinon
    .stub<never, ReturnType<MockInterceptor.MockReplyOptionsCallback>>()
    .returns({
      statusCode: 200,
      data: { result: true },
      responseOptions: { headers: { "Content-Type": "application/json" } }
    });

  mockAgent
    .get("http://opa.test:3000")
    .intercept({
      path: "/v1/data/query/ping",
      method: "POST"
    })
    .reply(opaPolicyMock);

  const testClient = createGraphqlTestClient(app);
  const response = await testClient.query(`#graphql
      query { ping(message: "pong") }
    `);

  deepStrictEqual(response, { data: { ping: "pong" } });

  const body = JSON.parse(opaPolicyMock.firstCall?.firstArg?.body);

  deepStrictEqual(body?.input?.args, { message: "pong" });
  deepStrictEqual(body?.input?.options, {
    bar: "foo",
    baz: 123,
    qux: true,
    bing: { bong: "doo" },
    fl: 1.34,
    n: null,
    arr: [{ a: "b" }, { c: "d" }]
  });
});

test("authenticated query should fail when opa throws", async () => {
  const schema = `#graphql
  ${fs.readFileSync(path.join(__dirname, "../lib/opaAuthDirective.gql"), "utf-8")}
  type Query {
      ping(message: String!): String! @opa(path: "query/ping")
  }
  `;

  const app = await createApp(schema, {
    Query: {
      ping: (source, args) => args.message
    }
  });

  mockAgent
    .get("http://opa.test:3000")
    .intercept({
      path: "/v1/data/query/ping",
      method: "POST"
    })
    .reply(
      400,
      { warning: {code: "invalid input" } },
      { headers: { "Content-Type": "application/json" } }
    );

  const testClient = createGraphqlTestClient(app);
  const response = await testClient.query(`#graphql
    query { ping(message: "pong") }
  `);

  deepStrictEqual(response, {
    data: null,
    errors: [
      {
        extensions: {
          code: "NOT_AUTHORIZED"
        },
        locations: [
          {
            column: 13,
            line: 2
          }
        ],
        message: "Internal Server Error",
        path: ["ping"]
      }
    ]
  });
});